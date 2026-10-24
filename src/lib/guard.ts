/**
 * Abuse and budget guard for the public demo: fixed-window counters per IP
 * per minute and per UTC day, and for all uncached runs per UTC day. A run
 * that would call live Qloo is also refused up front, before it starts,
 * when today's Qloo budget can't cover a whole run (rather than failing
 * half-way through). Counters live in KV when
 * configured (shared by every instance; handlers stay stateless) and in a
 * bounded in-process map otherwise. Cached results never reach the guard.
 */
import { loadConfig } from "./config";
import { defaultCounter, incrDaily, incrPerMinute, readDaily, type Counter } from "./counter";

export interface GuardConfig {
  /** Uncached runs per IP per minute. */
  perMinute: number;
  /** Uncached runs per IP per UTC day, so one client can't spend everyone's day. */
  perIpDaily: number;
  /** Uncached runs per UTC day, all users. */
  dailyCap: number;
  /** With a Qloo key: today's live-call cap, and the most one run may spend (a run needs that much headroom to start). */
  qloo?: { dailyCap: number; runCap: number };
}

export function guardConfig(env: Record<string, string | undefined> = process.env): GuardConfig {
  const c = loadConfig(env);
  return {
    perMinute: c.RATE_LIMIT_PER_MINUTE,
    perIpDaily: c.RATE_LIMIT_PER_DAY,
    dailyCap: c.RUN_DAILY_CAP,
    ...(c.QLOO_API_KEY && c.QLOO_MODE !== "replay" ? { qloo: { dailyCap: c.QLOO_DAILY_CALL_CAP, runCap: c.QLOO_RUN_CALL_CAP } } : {}),
  };
}

export type GuardResult = { ok: true } | { ok: false; status: 429 | 503; message: string; retryAfter: number };

export interface GuardOptions {
  /** Apply the per-IP limits (presets skip them so the one-click demo always works; they still count toward the daily cap). */
  perIp?: boolean;
  now?: number;
}

export async function checkGuard(ip: string, cfg: GuardConfig = guardConfig(), counter: Counter = defaultCounter(), opts: GuardOptions = {}): Promise<GuardResult> {
  const now = opts.now ?? Date.now();
  const untilMidnight = 86400 - Math.floor((now / 1000) % 86400);
  // Today's live Qloo calls so far, counted by the Qloo client (qloo/client.ts) on the same counter: read here, not added to.
  if (cfg.qloo && (await readDaily(counter, "qloo-calls", now)) + cfg.qloo.runCap > cfg.qloo.dailyCap) {
    return { ok: false, status: 503, message: "Today's Qloo budget can't cover another new run. Presets and cached runs still load; try a new brief tomorrow.", retryAfter: untilMidnight };
  }
  if (opts.perIp ?? true) {
    if ((await incrPerMinute(counter, `rl:ip:${ip}`, now)) > cfg.perMinute) {
      return {
        ok: false,
        status: 429,
        message: "Too many new runs from your network. Wait a minute; presets and links you've already opened load from cache.",
        retryAfter: 60 - Math.floor((now / 1000) % 60),
      };
    }
    if ((await incrDaily(counter, `rl:ipday:${ip}`, now)) > cfg.perIpDaily) {
      return { ok: false, status: 429, message: "Your network has used today's new runs. Presets and links you've already opened still load.", retryAfter: untilMidnight };
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
