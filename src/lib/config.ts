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
  QLOO_DAILY_CALL_CAP: int(300, 0, 100000),
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
  SIGMORA_OWNER_KEY: z.string().min(32).optional(),

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
  return r.data;
}
