/**
 * Abuse and budget guard for the public demo: a per-IP token bucket and a
 * per-instance daily run cap. Preset runs are served from the result cache and
 * never reach this guard. State is per server instance (good enough to stop a
 * runaway client on serverless; a shared KV can replace it later).
 */

interface Bucket {
  tokens: number;
  updated: number;
}

const buckets = new Map<string, Bucket>();
let day = "";
let runsToday = 0;

export interface GuardConfig {
  /** Burst size per IP. */
  burst: number;
  /** Tokens regained per minute. */
  perMinute: number;
  /** Uncached runs per UTC day, per instance. */
  dailyCap: number;
}

export function guardConfig(env: Record<string, string | undefined> = process.env): GuardConfig {
  return {
    burst: Number(env.RATE_LIMIT_BURST ?? 5),
    perMinute: Number(env.RATE_LIMIT_PER_MINUTE ?? 2),
    dailyCap: Number(env.RUN_DAILY_CAP ?? 300),
  };
}

export type GuardResult = { ok: true } | { ok: false; status: 429 | 503; message: string; retryAfter: number };

export function checkGuard(ip: string, cfg: GuardConfig = guardConfig(), now = Date.now()): GuardResult {
  const today = new Date(now).toISOString().slice(0, 10);
  if (today !== day) {
    day = today;
    runsToday = 0;
  }
  if (runsToday >= cfg.dailyCap) {
    return { ok: false, status: 503, message: "Today's free run budget is spent. Presets still work instantly; try a custom brief tomorrow.", retryAfter: 3600 };
  }
  const b = buckets.get(ip) ?? { tokens: cfg.burst, updated: now };
  b.tokens = Math.min(cfg.burst, b.tokens + ((now - b.updated) / 60000) * cfg.perMinute);
  b.updated = now;
  if (b.tokens < 1) {
    buckets.set(ip, b);
    return { ok: false, status: 429, message: "Too many runs from your network. Wait a minute or open a preset.", retryAfter: Math.ceil(((1 - b.tokens) / cfg.perMinute) * 60) };
  }
  b.tokens -= 1;
  buckets.set(ip, b);
  runsToday += 1;
  if (buckets.size > 10000) buckets.clear();
  return { ok: true };
}

export function resetGuard() {
  buckets.clear();
  runsToday = 0;
  day = "";
}

export function clientIp(headers: Headers): string {
  return headers.get("x-forwarded-for")?.split(",")[0]?.trim() || headers.get("x-real-ip") || "unknown";
}
