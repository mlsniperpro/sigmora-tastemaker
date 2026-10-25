/**
 * Shared HTTP plumbing for every outbound call (Qloo, LLM, Sigmora, KV):
 * typed errors, a hard timeout, and bounded retries with exponential backoff
 * and full jitter that honour Retry-After. Only idempotent requests (GETs,
 * or POSTs carrying an Idempotency-Key) may be retried.
 */

export class HttpError extends Error {
  constructor(
    readonly service: string,
    readonly status: number,
    /** Path only; never the query string (it can carry identifiers). */
    readonly path: string,
    readonly retryAfterMs?: number,
  ) {
    super(`${service} ${status} on ${path}`);
    this.name = "HttpError";
  }
}

export class TimeoutError extends Error {
  constructor(
    readonly service: string,
    readonly path: string,
    readonly timeoutMs: number,
  ) {
    super(`${service} timed out after ${timeoutMs} ms on ${path}`);
    this.name = "TimeoutError";
  }
}

export interface RetryPolicy {
  /** Extra attempts after the first one. */
  retries: number;
  baseMs: number;
  maxMs: number;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
}

export const DEFAULT_RETRY: RetryPolicy = { retries: 2, baseMs: 250, maxMs: 4000 };

export const realSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** `base` (with or without a trailing slash) + `path` (starting with "/"). */
export const joinUrl = (base: string, path: string) => base.replace(/\/+$/, "") + path;

/** 408, 425, 429 and 5xx, timeouts and network failures are worth another try. */
export function isRetryable(err: unknown): boolean {
  if (err instanceof HttpError) return err.status === 408 || err.status === 425 || err.status === 429 || err.status >= 500;
  if (err instanceof TimeoutError) return true;
  // fetch() rejects with a TypeError on DNS / connection failures.
  return err instanceof TypeError;
}

/** Full-jitter exponential backoff, or the server's Retry-After when it gives one. */
export function backoffMs(attempt: number, policy: RetryPolicy, retryAfterMs?: number): number {
  if (retryAfterMs !== undefined) return Math.min(policy.maxMs, Math.max(0, retryAfterMs));
  const ceiling = Math.min(policy.maxMs, policy.baseMs * 2 ** attempt);
  return Math.floor((policy.random ?? Math.random)() * ceiling);
}

/** Parses Retry-After as delta-seconds or an HTTP date. */
export function parseRetryAfter(header: string | null, now = Date.now()): number | undefined {
  if (!header) return undefined;
  const s = Number(header);
  if (Number.isFinite(s) && s >= 0) return s * 1000;
  const t = Date.parse(header);
  return Number.isNaN(t) ? undefined : Math.max(0, t - now);
}

export async function withRetry<T>(fn: (attempt: number) => Promise<T>, policy: RetryPolicy = DEFAULT_RETRY): Promise<T> {
  const sleep = policy.sleep ?? realSleep;
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn(attempt);
    } catch (err) {
      if (attempt >= policy.retries || !isRetryable(err)) throw err;
      await sleep(backoffMs(attempt, policy, err instanceof HttpError ? err.retryAfterMs : undefined));
    }
  }
}

/**
 * fetch with a hard deadline that covers the whole exchange: headers *and*
 * the body read (res.json() / res.text()). A server that sends headers and
 * then stalls the body still fails with TimeoutError at `timeoutMs`, rather
 * than hanging the caller. The timer is cleared once the body is fully read,
 * cancelled or errored.
 */
export async function fetchWithTimeout(
  fetchImpl: typeof fetch,
  service: string,
  url: string | URL,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const ctrl = new AbortController();
  const path = new URL(url).pathname;
  const timeout = () => new TimeoutError(service, path, timeoutMs);
  /** Set once headers arrive: errors the body stream when the deadline passes mid-read. */
  let onTimeout: (() => void) | undefined;
  const timer = setTimeout(() => {
    ctrl.abort();
    onTimeout?.();
  }, timeoutMs);
  let res: Response;
  try {
    res = await fetchImpl(url, { ...init, signal: ctrl.signal });
  } catch (err) {
    clearTimeout(timer);
    if (ctrl.signal.aborted) throw timeout();
    throw err;
  }
  const body = res.body;
  if (!body) {
    clearTimeout(timer);
    return res;
  }
  const reader = body.getReader();
  let finished = false;
  const finish = () => {
    finished = true;
    clearTimeout(timer);
  };
  const guarded = new ReadableStream<Uint8Array>({
    start(controller) {
      onTimeout = () => {
        if (finished) return;
        finish();
        controller.error(timeout());
        reader.cancel().catch(() => undefined);
      };
    },
    async pull(controller) {
      try {
        const { done, value } = await reader.read();
        if (finished) return;
        if (done) {
          finish();
          controller.close();
        } else controller.enqueue(value);
      } catch (err) {
        if (finished) return;
        finish();
        controller.error(ctrl.signal.aborted ? timeout() : err);
      }
    },
    cancel(reason) {
      finish();
      return reader.cancel(reason);
    },
  });
  return new Response(guarded, { status: res.status, statusText: res.statusText, headers: res.headers });
}

/** Turns a non-2xx response into an HttpError (draining the body so the socket is freed). */
export async function ensureOk(res: Response, service: string, url: string | URL): Promise<Response> {
  if (res.ok) return res;
  await res.body?.cancel().catch(() => undefined);
  throw new HttpError(service, res.status, new URL(url).pathname, parseRetryAfter(res.headers.get("retry-after")));
}
