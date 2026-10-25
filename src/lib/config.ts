/**
 * Server configuration, read once from env and validated. Secrets only ever
 * come from here; nothing is hard-coded and nothing reaches the browser.
 */
import { z } from "zod";
import { formatZodIssues } from "./zod";

const optional = z.string().optional();
const int = (def: number, min: number, max: number) => z.coerce.number().int().min(min).max(max).default(def);

export const EnvSchema = z.object({
  QLOO_API_KEY: optional,
  QLOO_BASE_URL: optional.pipe(z.url().optional()),
  QLOO_MODE: z.enum(["auto", "live", "replay"]).default("auto"),
  /** Live Qloo calls per run (cache hits are free). */
  QLOO_RUN_CALL_CAP: int(90, 10, 500),
  /** Calls a new run reserves from the daily budget before it starts (the measured preset runs make 58–75; unspent calls go back). */
  QLOO_RUN_ESTIMATE: int(80, 10, 500),
  /** Live Qloo calls per UTC day, shared across instances when KV is set. */
  QLOO_DAILY_CALL_CAP: int(400, 0, 100000),
  /** A custom brief or "Re-run live" draws on its caller's own daily share (per IP, or per IPv6 /64) of this many calls. */
  QLOO_IP_DAILY_CALLS: int(160, 10, 100000),
  /** The presets' pool: the part of the day's calls cold preset runs draw on. Custom briefs draw on the rest, so neither can starve the other. */
  QLOO_PRESET_POOL: int(240, 0, 100000),
  /** Live calls one preset may spend per day across every instance (a cold preset runs once, then serves from cache). */
  QLOO_PRESET_DAILY_CALLS: int(160, 10, 100000),
  /** Requests per second to the Qloo host (the hackathon key allows ~5). */
  QLOO_RPS: int(4, 1, 50),
  QLOO_TIMEOUT_MS: int(12000, 1000, 60000),
  /** bias.trends on candidate discovery for timing-sensitive types; "off" to stop sending it. */
  QLOO_BIAS_TRENDS: z.enum(["off", "low", "medium", "high"]).default("medium"),
  /** diversify.by=subtype on brand and venue discovery; "off" to stop sending it. */
  QLOO_DIVERSIFY: z.enum(["on", "off"]).default("on"),

  LLM_PROVIDER: optional,
  LLM_MODEL: optional,
  LLM_API_KEY: optional,
  LLM_BASE_URL: optional.pipe(z.url().optional()),
  LLM_TIMEOUT_MS: int(25000, 1000, 120000),

  /** Benchmark judge model; each unset value falls back to the LLM_* setting. */
  JUDGE_PROVIDER: optional,
  JUDGE_MODEL: optional,
  JUDGE_API_KEY: optional,
  JUDGE_BASE_URL: optional.pipe(z.url().optional()),

  SIGMORA_PUBLISH_MODE: z.enum(["sandbox", "live"]).default("sandbox"),
  SIGMORA_API_URL: optional.pipe(z.url().optional()),
  SIGMORA_API_TOKEN: optional,
  /** Live mode only: the owner's key. Only requests carrying it reach the real publisher; everyone else gets the sandbox. */
  SIGMORA_OWNER_KEY: z.string().min(32).refine((k) => new Set(k).size >= 12, "needs at least 12 distinct characters (use `openssl rand -hex 24`)").optional(),

  KV_REST_API_URL: optional.pipe(z.url().optional()),
  KV_REST_API_TOKEN: optional,

  /** Uncached runs per IP per minute. */
  RATE_LIMIT_PER_MINUTE: int(4, 1, 1000),
  /** Uncached runs per IP per UTC day. */
  RATE_LIMIT_PER_DAY: int(20, 1, 100000),
  /** Uncached runs per UTC day (all users). */
  RUN_DAILY_CAP: int(150, 1, 1000000),
  /** Comma-separated origins allowed to call /api/mcp from a browser. */
  MCP_ALLOWED_ORIGINS: optional,
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
  return r.data;
}

/**
 * Budget settings that can't work together: a run must fit every share it
 * reserves from, or that kind of run is refused all day (a live config is only
 * checked when Qloo can actually be called, i.e. outside offline mode).
 */
export function budgetProblems(c: Env): string[] {
  const customPool = c.QLOO_DAILY_CALL_CAP - c.QLOO_PRESET_POOL;
  const out: string[] = [];
  if (c.QLOO_DAILY_CALL_CAP === 0) return out; // live calls switched off entirely
  if (customPool < c.QLOO_RUN_ESTIMATE) out.push(`QLOO_DAILY_CALL_CAP − QLOO_PRESET_POOL (${customPool}) must cover one run (QLOO_RUN_ESTIMATE ${c.QLOO_RUN_ESTIMATE})`);
  if (c.QLOO_PRESET_POOL < c.QLOO_RUN_ESTIMATE) out.push(`QLOO_PRESET_POOL (${c.QLOO_PRESET_POOL}) must cover one run (QLOO_RUN_ESTIMATE ${c.QLOO_RUN_ESTIMATE})`);
  if (c.QLOO_IP_DAILY_CALLS < c.QLOO_RUN_ESTIMATE) out.push(`QLOO_IP_DAILY_CALLS (${c.QLOO_IP_DAILY_CALLS}) must cover one run (QLOO_RUN_ESTIMATE ${c.QLOO_RUN_ESTIMATE})`);
  if (c.QLOO_PRESET_DAILY_CALLS < c.QLOO_RUN_ESTIMATE) out.push(`QLOO_PRESET_DAILY_CALLS (${c.QLOO_PRESET_DAILY_CALLS}) must cover one run (QLOO_RUN_ESTIMATE ${c.QLOO_RUN_ESTIMATE})`);
  if (c.QLOO_IP_DAILY_CALLS > customPool) out.push(`QLOO_IP_DAILY_CALLS (${c.QLOO_IP_DAILY_CALLS}) can't exceed the custom pool QLOO_DAILY_CALL_CAP − QLOO_PRESET_POOL (${customPool}), or one network can spend it all`);
  return out;
}
