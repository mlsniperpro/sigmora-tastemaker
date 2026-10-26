/**
 * Abuse and budget guard for the public demo: fixed-window counters per IP
 * per minute and per UTC day, and for all uncached runs per UTC day. (A
 * run's Qloo calls are reserved separately, by QlooClient.reserve.) Counters live in KV when
 * configured (shared by every instance; handlers stay stateless) and in a
 * bounded in-process map otherwise. Cached results never reach the guard.
 */
import { loadConfig } from "./config";
import { MemoryCounter, defaultCounter, incrDaily, incrPerMinute, type Counter } from "./counter";
import type { ReserveOptions } from "./qloo/client";

export interface GuardConfig {
  /** Uncached runs per IP per minute. */
  perMinute: number;
  /** Uncached runs per IP per UTC day, so one client can't spend everyone's day. */
  perIpDaily: number;
  /** Uncached runs per UTC day, all users. */
  dailyCap: number;
}

export function guardConfig(env: Record<string, string | undefined> = process.env): GuardConfig {
  const c = loadConfig(env);
  return {
    perMinute: c.RATE_LIMIT_PER_MINUTE,
    perIpDaily: c.RATE_LIMIT_PER_DAY,
    dailyCap: c.RUN_DAILY_CAP,
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

/** Today's live Qloo budget can't cover another job (QlooClient.reserve said no). */
export const QLOO_SPENT: Extract<GuardResult, { ok: false }> = {
  ok: false,
  status: 503,
  message: "Today's Qloo budget can't cover another new run. Presets and cached runs still load; try a new brief tomorrow.",
  retryAfter: 3600,
};

/** The refusal for a reserve() that said no, worded for the share that ran out (QlooClient.refusedBy). */
export function qlooRefusal(refusedBy: string | undefined): Extract<GuardResult, { ok: false }> {
  const still = "Presets, permalinks and cached runs still load.";
  if (refusedBy?.startsWith("ip:")) {
    return { ...QLOO_SPENT, status: 429, message: `Your network has used today's share of live Qloo calls (the demo's daily quota is small and shared fairly). ${still}` };
  }
  if (refusedBy?.startsWith("preset:")) return { ...QLOO_SPENT, message: `This preset has used today's live re-runs. ${still}` };
  if (refusedBy === "pool:custom") return { ...QLOO_SPENT, message: `Today's live Qloo budget for new briefs and audits is spent. ${still}` };
  if (refusedBy === "store") return { ...QLOO_SPENT, message: `The Qloo budget can't be checked right now, so no new live run starts. ${still}`, retryAfter: 60 };
  return QLOO_SPENT;
}

/** The HTTP response for a refused request. */
export function guardResponse(g: Extract<GuardResult, { ok: false }>): Response {
  return Response.json({ error: g.message }, { status: g.status, headers: { "Retry-After": String(g.retryAfter) } });
}

/**
 * Gives back what admit() counted, for an admitted request that then failed before spending anything
 * (say, no audience name resolved), so such failures can't use up the day's run cap for everyone.
 */
export function refundAdmission(req: Request, opts: { perIp?: boolean } = {}, counter: Counter = defaultCounter(), now = Date.now()): Promise<void> {
  return refundAdmissionFor(clientIp(req.headers), opts, counter, now);
}

/** refundAdmission by the caller's rate-limit key (MCP has no Request at that point). */
export async function refundAdmissionFor(ip: string, opts: { perIp?: boolean } = {}, counter: Counter = defaultCounter(), now = Date.now()): Promise<void> {
  try {
    await incrDaily(counter, "rl:runs", now, -1);
    if (opts.perIp ?? true) await incrDaily(counter, `rl:ipday:${ip}`, now, -1);
  } catch (err) {
    console.warn(`[guard] couldn't refund an admission: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/** Admits a request that is about to spend money; free requests always pass. */
export async function admit(req: Request, opts: { costs: boolean; perIp?: boolean }): Promise<GuardResult> {
  if (!opts.costs) return { ok: true };
  return checkGuard(clientIp(req.headers), undefined, undefined, { perIp: opts.perIp });
}

/**
 * The caller's IP as the platform proxy saw it. On Vercel, x-vercel-forwarded-for
 * (and the first x-forwarded-for entry) is set by the edge and can't be spoofed
 * by the client; the domain must not sit behind another proxy, or every visitor
 * shares the proxy's address.
 */
export function clientIp(headers: Headers): string {
  const first = (h: string | null) => h?.split(",")[0]?.trim() || undefined;
  return ipKey(first(headers.get("x-vercel-forwarded-for")) ?? first(headers.get("x-forwarded-for")) ?? headers.get("x-real-ip") ?? "unknown");
}

/**
 * The rate-limit key for an address: IPv4 as is; IPv6 by its /64, since one
 * host controls a whole /64 and could rotate through it to dodge per-IP limits.
 */
export function ipKey(ip: string): string {
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(ip);
  if (mapped?.[1]) return mapped[1];
  if (!ip.includes(":")) return ip;
  const addr = ip.replace(/^\[|\](:\d+)?$/g, "").split("%")[0] ?? "";
  const [head = "", tail] = addr.toLowerCase().split("::", 2);
  const h = head ? head.split(":") : [];
  const t = tail ? tail.split(":") : [];
  const groups = tail === undefined ? h : [...h, ...Array<string>(Math.max(0, 8 - h.length - t.length)).fill("0"), ...t];
  if (groups.length !== 8 || !groups.every((g) => /^[0-9a-f]{1,4}$/.test(g))) return addr.toLowerCase();
  return `${groups.slice(0, 4).map((g) => g.replace(/^0+(?=.)/, "")).join(":")}::/64`;
}

/**
 * How a new run's Qloo calls are reserved. The day is split into two pools:
 * cold preset runs draw on the presets' pool (and their own preset's share, so
 * a burst of identical cold requests across instances can't drain it), custom
 * briefs and "Re-run live" on the custom pool (and their network's share).
 * Neither kind can starve the other, and no one network can take the custom pool.
 */
export function qlooBudget(run: { presetId?: string; fresh: boolean }, ip: string, env: Record<string, string | undefined> = process.env): ReserveOptions {
  const c = loadConfig(env);
  if (run.presetId && !run.fresh) {
    return { scopes: [{ key: "pool:presets", cap: c.QLOO_PRESET_POOL }, { key: `preset:${run.presetId}`, cap: c.QLOO_PRESET_DAILY_CALLS }] };
  }
  return { scopes: [{ key: "pool:custom", cap: c.QLOO_DAILY_CALL_CAP - c.QLOO_PRESET_POOL }, { key: `ip:${ip}`, cap: c.QLOO_IP_DAILY_CALLS }] };
}

/** Requests per IP per minute to any API route, paid or not. */
export const FREE_ROUTE_PER_MINUTE = 120;
// In-process on purpose: this limit must cost nothing (no KV round trip) to check.
const freeCounter = new MemoryCounter(20000);

/**
 * A cheap per-instance flood guard for every API route, including the free
 * ones (permalinks, Ship lookups), so scripted floods can't burn the KV quota.
 * Undefined when the request may go on.
 */
export async function floodGuard(req: Request, now = Date.now()): Promise<Response | undefined> {
  if ((await incrPerMinute(freeCounter, `flood:${clientIp(req.headers)}`, now)) <= FREE_ROUTE_PER_MINUTE) return undefined;
  return Response.json({ error: "Too many requests from your network. Wait a minute." }, { status: 429, headers: { "Retry-After": String(60 - Math.floor((now / 1000) % 60)) } });
}
