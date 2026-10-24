/**
 * Abuse and budget guard for the public demo: fixed-window counters per IP
 * per minute and for all uncached runs per UTC day. Counters live in KV when
 * configured (shared by every instance; handlers stay stateless) and in a
 * bounded in-process map otherwise. Cached results never reach the guard.
 */
import { loadConfig } from "./config";
import { defaultCounter, incrDaily, incrPerMinute, type Counter } from "./counter";

export interface GuardConfig {
  /** Uncached runs per IP per minute. */
  perMinute: number;
  /** Uncached runs per UTC day, all users. */
  dailyCap: number;
}

export function guardConfig(env: Record<string, string | undefined> = process.env): GuardConfig {
  const c = loadConfig(env);
  return { perMinute: c.RATE_LIMIT_PER_MINUTE, dailyCap: c.RUN_DAILY_CAP };
}

export type GuardResult = { ok: true } | { ok: false; status: 429 | 503; message: string; retryAfter: number };

export interface GuardOptions {
  /** Apply the per-IP limit (presets skip it so the one-click demo always works; they still count toward the daily cap). */
  perIp?: boolean;
  now?: number;
}

export async function checkGuard(ip: string, cfg: GuardConfig = guardConfig(), counter: Counter = defaultCounter(), opts: GuardOptions = {}): Promise<GuardResult> {
  const now = opts.now ?? Date.now();
  if (opts.perIp ?? true) {
    if ((await incrPerMinute(counter, `rl:ip:${ip}`, now)) > cfg.perMinute) {
      return {
        ok: false,
        status: 429,
        message: "Too many new runs from your network. Wait a minute; presets and links you've already opened load from cache.",
        retryAfter: 60 - Math.floor((now / 1000) % 60),
      };
    }
  }
  if ((await incrDaily(counter, "rl:runs", now)) > cfg.dailyCap) {
    return { ok: false, status: 503, message: "Today's budget for new runs is spent. Cached runs still load; try a new brief tomorrow.", retryAfter: 3600 };
  }
  return { ok: true };
}

/** The HTTP response for a refused request. */
export function guardResponse(g: Extract<GuardResult, { ok: false }>): Response {
  return Response.json({ error: g.message }, { status: g.status, headers: { "Retry-After": String(g.retryAfter) } });
}

/** Admits a request that is about to spend money; free requests always pass. */
export async function admit(req: Request, opts: { costs: boolean; perIp?: boolean }): Promise<GuardResult> {
  if (!opts.costs) return { ok: true };
  return checkGuard(clientIp(req.headers), undefined, undefined, { perIp: opts.perIp });
}

/**
 * The caller's IP as seen by the platform proxy. On Vercel the first
 * x-forwarded-for entry is set by the edge and can't be spoofed by the client.
 */
export function clientIp(headers: Headers): string {
  return headers.get("x-forwarded-for")?.split(",")[0]?.trim() || headers.get("x-real-ip") || "unknown";
}
