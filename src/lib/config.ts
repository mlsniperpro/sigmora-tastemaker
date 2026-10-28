/**
 * Server configuration, read once from env and validated. Secrets only ever
 * come from here; nothing is hard-coded and nothing reaches the browser.
 */
import { z } from "zod";
import { formatZodIssues } from "./zod";

const optional = z.string().optional();
const int = (def: number, min: number, max: number) => z.coerce.number().int().min(min).max(max).default(def);
/** A base URL that carries a secret: https only, except a local development host. */
const secureUrl = optional.pipe(
  z
    .url()
    .refine((u) => {
      if (!URL.canParse(u)) return true; // z.url() already reports it
      const { protocol, hostname } = new URL(u);
      return protocol === "https:" || (protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(hostname));
    }, "must use https (plain http only for localhost)")
    .optional(),
);

export const EnvSchema = z.object({
  QLOO_API_KEY: optional,
  QLOO_BASE_URL: secureUrl,
  QLOO_MODE: z.enum(["auto", "live", "replay"]).default("auto"),
  /** Live Qloo calls per run (cache hits are free). */
  QLOO_RUN_CALL_CAP: int(90, 10, 500),
  /** Calls a new run reserves from the daily budget before it starts (the measured preset runs make 60–75; unspent calls go back). */
  QLOO_RUN_ESTIMATE: int(80, 10, 500),
  /** Live Qloo calls per UTC day, shared across instances when KV is set. */
  QLOO_DAILY_CALL_CAP: int(480, 0, 100000),
  /** A custom brief or "Re-run live" draws on its caller's own daily share (per IP, or per IPv6 /64) of this many calls. */
  QLOO_IP_DAILY_CALLS: int(80, 10, 100000),
  /** The presets' pool: the part of the day's calls cold preset runs draw on. Custom briefs draw on the rest, so neither can starve the other. */
  QLOO_PRESET_POOL: int(240, 0, 100000),
  /** Live calls one preset may spend per day across every instance (a cold preset runs once, then serves from cache). */
  QLOO_PRESET_DAILY_CALLS: int(160, 10, 100000),
  /** Requests per second to the Qloo host (the hackathon key allows ~5). */
  QLOO_RPS: int(4, 1, 50),
  QLOO_TIMEOUT_MS: int(12000, 1000, 60000),
  /** bias.trends on candidate discovery for timing-sensitive types (Qloo's own default is "medium", so "high" is what leans); "off" to stop sending it. */
  QLOO_BIAS_TRENDS: z.enum(["off", "very_low", "low", "mid", "medium", "high", "very_high"]).default("high"),
  /** diversify.by=subtype on taste-vocabulary (urn:tag) discovery; "off" to stop sending it. */
  QLOO_DIVERSIFY: z.enum(["on", "off"]).default("on"),

  LLM_PROVIDER: optional,
  LLM_MODEL: optional,
  LLM_API_KEY: optional,
  LLM_BASE_URL: secureUrl,
  LLM_TIMEOUT_MS: int(25000, 1000, 120000),

  /** Benchmark judge model; each unset value falls back to the LLM_* setting. */
  JUDGE_PROVIDER: optional,
  JUDGE_MODEL: optional,
  JUDGE_API_KEY: optional,
  JUDGE_BASE_URL: secureUrl,

  SIGMORA_PUBLISH_MODE: z.enum(["sandbox", "live"]).default("sandbox"),
  SIGMORA_API_URL: secureUrl,
  SIGMORA_API_TOKEN: optional,
  /** Live mode only: the owner's key. Only requests carrying it reach the real publisher; everyone else gets the sandbox. */
  SIGMORA_OWNER_KEY: z.string().min(32).refine((k) => new Set(k).size >= 12, "needs at least 12 distinct characters (use `openssl rand -hex 24`)").optional(),

  KV_REST_API_URL: secureUrl,
  KV_REST_API_TOKEN: optional,

  /** Uncached runs per IP per minute. */
  RATE_LIMIT_PER_MINUTE: int(4, 1, 1000),
  /** Uncached runs per IP per UTC day. */
  RATE_LIMIT_PER_DAY: int(20, 1, 100000),
  /** Uncached runs per UTC day (all users). */
  RUN_DAILY_CAP: int(150, 1, 1000000),
  /** Comma-separated origins allowed to call /api/mcp from a browser. */
  MCP_ALLOWED_ORIGINS: optional,
  /**
   * The committed recordings (fixtures/qloo, fixtures/runs, fixtures/audits) answer by default; "off" ignores them, so
   * the test suites see the same offline stack before and after the owner records live data.
   */
  TASTEMAKER_RECORDINGS: z.enum(["on", "off"]).default("on"),
  /** Set by Vercel on every build and function: a hosted, multi-instance deployment. */
  VERCEL: optional,
});
export type Env = z.infer<typeof EnvSchema>;

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

let memo: { env: Record<string, string | undefined>; snapshot: string; value: Env } | undefined;

/** Parsed once per distinct environment (process.env is re-checked cheaply so tests that stub it still work). */
export function loadConfig(env: Record<string, string | undefined> = process.env): Env {
  const snapshot = JSON.stringify(Object.keys(EnvSchema.shape).map((k) => env[k]));
  if (memo && memo.env === env && memo.snapshot === snapshot) return memo.value;
  const value = parseEnv(env);
  memo = { env, snapshot, value };
  return value;
}

function parseEnv(env: Record<string, string | undefined>): Env {
  // A variable set to blank (common in hosting dashboards) means "unset": defaults apply, never "" or 0.
  const set = Object.fromEntries(Object.entries(env).flatMap(([k, v]) => (v?.trim() ? [[k, v.trim()]] : [])));
  const r = EnvSchema.safeParse(set);
  if (!r.success) {
    // formatZodIssues names the variables, never their values.
    throw new ConfigError(`Invalid environment: ${formatZodIssues(r.error)}`);
  }
  const problems = budgetProblems(r.data);
  if (problems.length) throw new ConfigError(`Invalid Qloo budget: ${problems.join("; ")}`);
  const kv = kvProblems(r.data);
  if (kv.length) throw new ConfigError(`Invalid KV setup: ${kv.join("; ")}`);
  return r.data;
}

/**
 * The money counters are only shared across instances through KV. On a hosted
 * (serverless) deployment that can spend, each instance counting in its own
 * memory would hand every cold start a fresh daily budget, so a paid key
 * without KV fails the build instead of overspending quietly.
 */
export function kvProblems(c: Env): string[] {
  const out: string[] = [];
  if (Boolean(c.KV_REST_API_URL) !== Boolean(c.KV_REST_API_TOKEN)) out.push("set both KV_REST_API_URL and KV_REST_API_TOKEN, or neither");
  else if (c.VERCEL && !c.KV_REST_API_URL && (c.QLOO_API_KEY || c.LLM_API_KEY || c.JUDGE_API_KEY)) {
    out.push("a hosted deployment with QLOO_API_KEY, LLM_API_KEY or JUDGE_API_KEY needs KV_REST_API_URL and KV_REST_API_TOKEN, so the daily budgets hold across instances");
  }
  return out;
}

/** Most live Qloo calls one "Audit any AI's plan" request makes; tests/integration/audit.test.ts holds a worst-case plan to it. */
export const AUDIT_CALL_ESTIMATE = 80;
/**
 * Live Qloo calls an audit reserves up front (unspent ones go back). A typical plan spends about 20, so reserving
 * the worst case would let one audit block a network's next action for the day; calls past the reservation are
 * charged one by one to the same shares, and a cut audit degrades per name (unscored), never overspends.
 */
export const AUDIT_RESERVE = 30;
/** The custom pool must hold at least this many networks' full daily shares. */
export const NETWORKS_PER_POOL = 3;

/**
 * Budget settings that can't work together: a run must fit every share it
 * reserves from, or that kind of run is refused all day (a live config is only
 * checked when Qloo can actually be called, i.e. outside offline mode).
 */
/** The committed recordings, unless TASTEMAKER_RECORDINGS=off. */
export function recordings<T extends object>(store: T): T | Record<string, never> {
  return loadConfig().TASTEMAKER_RECORDINGS === "off" ? {} : store;
}

export function budgetProblems(c: Env): string[] {
  const customPool = c.QLOO_DAILY_CALL_CAP - c.QLOO_PRESET_POOL;
  const out: string[] = [];
  if (c.QLOO_DAILY_CALL_CAP === 0) return out; // live calls switched off entirely
  if (customPool < c.QLOO_RUN_ESTIMATE) out.push(`QLOO_DAILY_CALL_CAP − QLOO_PRESET_POOL (${customPool}) must cover one run (QLOO_RUN_ESTIMATE ${c.QLOO_RUN_ESTIMATE})`);
  if (c.QLOO_PRESET_POOL < c.QLOO_RUN_ESTIMATE) out.push(`QLOO_PRESET_POOL (${c.QLOO_PRESET_POOL}) must cover one run (QLOO_RUN_ESTIMATE ${c.QLOO_RUN_ESTIMATE})`);
  if (c.QLOO_IP_DAILY_CALLS < c.QLOO_RUN_ESTIMATE) out.push(`QLOO_IP_DAILY_CALLS (${c.QLOO_IP_DAILY_CALLS}) must cover one run (QLOO_RUN_ESTIMATE ${c.QLOO_RUN_ESTIMATE})`);
  if (c.QLOO_PRESET_DAILY_CALLS < c.QLOO_RUN_ESTIMATE) out.push(`QLOO_PRESET_DAILY_CALLS (${c.QLOO_PRESET_DAILY_CALLS}) must cover one run (QLOO_RUN_ESTIMATE ${c.QLOO_RUN_ESTIMATE})`);
  if (c.QLOO_IP_DAILY_CALLS < AUDIT_CALL_ESTIMATE) out.push(`QLOO_IP_DAILY_CALLS (${c.QLOO_IP_DAILY_CALLS}) must cover one plan audit (${AUDIT_CALL_ESTIMATE} calls)`);
  if (c.QLOO_IP_DAILY_CALLS * NETWORKS_PER_POOL > customPool) out.push(`QLOO_IP_DAILY_CALLS (${c.QLOO_IP_DAILY_CALLS}) can be at most 1/${String(NETWORKS_PER_POOL)} of the custom pool QLOO_DAILY_CALL_CAP − QLOO_PRESET_POOL (${customPool}), so one network can't spend it`);
  return out;
}
