import type { z } from "zod";
import recorded from "../../../fixtures/qloo/recorded.json";
import { loadConfig } from "../config";
import { defaultCounter, incrDaily, type Counter } from "../counter";
import { DEFAULT_RETRY, ensureOk, fetchWithTimeout, joinUrl, withRetry, type RetryPolicy } from "../net";
import { formatZodIssues } from "../zod";
import { defaultCache, type CacheStore } from "./cache";
import { QlooBudgetError, QlooDeadlineError, QlooSchemaError } from "./errors";
import { assertParams, requestKey, type QlooParams, type QlooPath } from "./params";
import { simulate } from "./sim/simulator";
import { Throttle } from "./throttle";
import {
  CompareResponse,
  InsightsResponse,
  SearchResponse,
  entityUrn,
  type EntityType,
  type InsightsFilterType,
} from "./types";

export type QlooSource = "live" | "replay" | "simulated";
export type QlooMode = "auto" | "live" | "replay";

export interface QlooCallMeta {
  path: QlooPath;
  params: QlooParams;
  key: string;
  source: QlooSource;
  cached: boolean;
  latencyMs: number;
  /** Set when a live call failed and the answer came from a recorded live response instead. */
  fallbackReason?: string;
}

export interface QlooCall<T> {
  data: T;
  meta: QlooCallMeta;
}

export interface QlooClientOptions {
  mode?: QlooMode;
  apiKey?: string;
  baseUrl?: string;
  cache?: CacheStore;
  fixtures?: Record<string, unknown>;
  /** When set, live responses are written here (fixture recording). */
  recorder?: Record<string, unknown>;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  throttle?: Throttle;
  retry?: RetryPolicy;
  /** Max network calls this client may make (one client per run). */
  runCallCap?: number;
  /** Shared daily cap on network calls. */
  daily?: { counter: Counter; cap: number };
}

const HACKATHON_HOST = "https://hackathon.api.qloo.com";
const TTL = 60 * 60 * 24 * 7;
const SERVICE = "Qloo";

/** Parameters whose values are sets: sorted so the same set always makes the same request (and cache key). */
const SET_PARAMS = ["filter.results.entities", "filter.exclude.entities"];

/**
 * Host quirks, applied to every request before it is keyed or sent.
 * - Demographic signals are dropped on urn:entity:person: there they replace
 *   the audience instead of narrowing it (reported by entrants on the live host).
 */
function normalize(params: QlooParams): QlooParams {
  const out: QlooParams = {};
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || (Array.isArray(v) && !v.length)) continue;
    out[k] = Array.isArray(v) && SET_PARAMS.includes(k) ? [...v].sort() : v;
  }
  if (out["filter.type"] === "urn:entity:person") {
    delete out["signal.demographics.age"];
    delete out["signal.demographics.gender"];
  }
  return out;
}

let sharedThrottle: Throttle | undefined;

export class QlooClient {
  readonly mode: QlooMode;
  private readonly apiKey?: string;
  private readonly baseUrl: string;
  private readonly cache: CacheStore;
  private readonly fixtures: Record<string, unknown>;
  private readonly fetchImpl: typeof fetch;
  private readonly observers = new Set<(m: QlooCallMeta) => void>();
  /** Identical requests in flight share one network call. */
  private readonly inFlight = new Map<string, Promise<{ raw: unknown; cached: boolean }>>();
  private networkCalls = 0;
  /** Calls already paid for out of today's budget by reserve(), not yet spent. */
  private prepaid = 0;
  /** Epoch ms after which no call is sent (set per job by setDeadline). */
  private deadlineAt = Infinity;

  constructor(private readonly opts: QlooClientOptions = {}) {
    this.apiKey = opts.apiKey;
    this.mode = opts.mode ?? "auto";
    this.baseUrl = opts.baseUrl ?? HACKATHON_HOST;
    this.cache = opts.cache ?? defaultCache();
    this.fixtures = opts.fixtures ?? recorded;
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  /** Where calls are answered from, before any fallback. */
  get primarySource(): QlooSource {
    if (this.mode !== "replay" && this.apiKey) return "live";
    return Object.keys(this.fixtures).length ? "replay" : "simulated";
  }

  /** Subscribe to every call's metadata (the agent builds its trace from this). Returns the unsubscribe. */
  observe(fn: (m: QlooCallMeta) => void): () => void {
    this.observers.add(fn);
    return () => this.observers.delete(fn);
  }

  /**
   * Answer order. With a key: live, then a recorded fixture of a live
   * response; if neither exists the live error is thrown (the trace shows it),
   * never simulator data mixed into a live run. Without a key (or in replay
   * mode): a recorded fixture, then the labeled simulator.
   */
  async get<S extends z.ZodType>(path: QlooPath, params: QlooParams, schema: S): Promise<QlooCall<z.infer<S>>> {
    const clean = normalize(params);
    const problems = assertParams(path, clean);
    if (problems.length) console.warn(`[qloo] request to ${path} has unsupported params (Qloo drops them silently): ${problems.join("; ")}`);
    const key = requestKey(path, clean);
    const started = Date.now();
    const done = (data: z.infer<S>, source: QlooSource, cached: boolean, fallbackReason?: string): QlooCall<z.infer<S>> => {
      const meta: QlooCallMeta = { path, params: clean, key, source, cached, latencyMs: Date.now() - started, fallbackReason };
      for (const fn of this.observers) fn(meta);
      return { data, meta };
    };
    const hasFixture = key in this.fixtures;

    if (this.primarySource === "live") {
      try {
        const live = await this.getLive(path, clean, key);
        return done(this.parse(path, schema, live.raw), "live", live.cached);
      } catch (err) {
        if (this.mode === "live" || !hasFixture) throw err;
        const reason = err instanceof Error ? err.message : String(err);
        console.warn(`[qloo] live call failed, using the recorded response: ${reason}`);
        return done(this.parse(path, schema, this.fixtures[key]), "replay", false, reason);
      }
    }
    if (hasFixture) return done(this.parse(path, schema, this.fixtures[key]), "replay", false);
    return done(this.parse(path, schema, simulate(path, clean)), "simulated", false);
  }

  private parse<S extends z.ZodType>(path: string, schema: S, raw: unknown): z.infer<S> {
    const r = schema.safeParse(raw);
    if (!r.success) throw new QlooSchemaError(path, formatZodIssues(r.error, { max: 3 }));
    return r.data;
  }

  private getLive(path: QlooPath, params: QlooParams, key: string) {
    const pending = this.inFlight.get(key);
    if (pending) return pending;
    const p = this.fetchLive(path, params, key).finally(() => this.inFlight.delete(key));
    this.inFlight.set(key, p);
    return p;
  }

  private async fetchLive(path: QlooPath, params: QlooParams, key: string): Promise<{ raw: unknown; cached: boolean }> {
    const hit = await this.cache.get(key);
    if (hit !== undefined) return { raw: hit, cached: true };
    // Every network attempt, retries included, is paid for from the budget.
    const raw = await withRetry(async () => {
      await this.spendBudget();
      return this.fetchOnce(path, params);
    }, this.opts.retry ?? DEFAULT_RETRY);
    await this.cache.set(key, raw, TTL);
    if (this.opts.recorder) this.opts.recorder[key] = raw;
    return { raw, cached: false };
  }

  /** No Qloo call is sent after `at` (epoch ms), including ones still queued behind the rate limit. */
  setDeadline(at: number) {
    this.deadlineAt = at;
  }

  private async spendBudget() {
    const cap = this.opts.runCallCap;
    if (Date.now() > this.deadlineAt) throw new QlooDeadlineError();
    // Reserve synchronously so parallel calls can't all pass the check.
    if (cap !== undefined && this.networkCalls >= cap) throw new QlooBudgetError("run", cap);
    this.networkCalls++;
    if (this.prepaid > 0) {
      this.prepaid--;
      return;
    }
    const daily = this.opts.daily;
    if (daily && (await incrDaily(daily.counter, "qloo-calls")) > daily.cap) throw new QlooBudgetError("day", daily.cap);
  }

  /**
   * Takes `calls` out of today's live budget up front, in one atomic step, so a
   * job that starts can finish: concurrent jobs can't all pass a check and then
   * run dry half-way. False (and nothing taken) when today's budget can't cover it.
   * Free when this client makes no live calls.
   */
  async reserve(calls: number): Promise<boolean> {
    const daily = this.opts.daily;
    if (!daily || this.primarySource !== "live" || calls <= 0) return true;
    if ((await incrDaily(daily.counter, "qloo-calls", Date.now(), calls)) > daily.cap) {
      await incrDaily(daily.counter, "qloo-calls", Date.now(), -calls);
      return false;
    }
    this.prepaid += calls;
    return true;
  }

  /** Gives back whatever reserve() took and the job didn't spend. */
  async release(): Promise<void> {
    const daily = this.opts.daily;
    const unspent = this.prepaid;
    this.prepaid = 0;
    if (daily && unspent > 0) await incrDaily(daily.counter, "qloo-calls", Date.now(), -unspent);
  }

  private async fetchOnce(path: QlooPath, params: QlooParams): Promise<unknown> {
    const apiKey = this.apiKey;
    if (!apiKey) throw new Error("QlooClient: a live call needs an API key");
    const url = new URL(joinUrl(this.baseUrl, path));
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined) url.searchParams.set(k, Array.isArray(v) ? v.join(",") : String(v));
    }
    const call = async () => {
      // Checked after the throttle wait too: a call queued behind other runs mustn't go out past the deadline.
      if (Date.now() > this.deadlineAt) throw new QlooDeadlineError();
      const res = await fetchWithTimeout(
        this.fetchImpl,
        SERVICE,
        url,
        { method: "GET", headers: { "X-Api-Key": apiKey, Accept: "application/json" }, cache: "no-store" },
        this.opts.timeoutMs ?? 12000,
      );
      await ensureOk(res, SERVICE, url);
      return (await res.json()) as unknown;
    };
    return this.opts.throttle ? this.opts.throttle.run(call) : call();
  }

  // ---- typed helpers -----------------------------------------------------

  search(query: string, types?: readonly EntityType[], take = 5) {
    return this.get("/search", { query, types: types?.map(entityUrn), take }, SearchResponse);
  }

  entitiesByExternal(kind: "spotify" | "imdb", ids: string[]) {
    return this.get("/entities", { [`external.${kind}.ids`]: ids }, SearchResponse);
  }

  insights(filterType: InsightsFilterType, params: QlooParams) {
    return this.get("/v2/insights", { "filter.type": filterType, ...params }, InsightsResponse);
  }

  trending(type: EntityType, entityIds: string[]) {
    return this.get("/v2/trending", { "filter.type": entityUrn(type), "signal.interests.entities": entityIds }, InsightsResponse);
  }

  compare(a: string[], b: string[], take = 10) {
    return this.get("/v2/analysis/compare", { "a.signal.interests.entities": a, "b.signal.interests.entities": b, take }, CompareResponse);
  }

  tags(query: string, take = 10) {
    return this.get("/v2/tags", { "filter.query": query, "feature.semantic_search": true, take }, InsightsResponse);
  }
}

/** A fresh client per run (the run budget is per client), sharing the process throttle and daily counter. */
export function qlooFromEnv(overrides: Partial<QlooClientOptions> = {}): QlooClient {
  const env = loadConfig();
  sharedThrottle ??= new Throttle(env.QLOO_RPS, env.QLOO_RPS);
  return new QlooClient({
    apiKey: env.QLOO_API_KEY,
    baseUrl: env.QLOO_BASE_URL,
    mode: env.QLOO_MODE,
    timeoutMs: env.QLOO_TIMEOUT_MS,
    throttle: sharedThrottle,
    runCallCap: env.QLOO_RUN_CALL_CAP,
    daily: { counter: defaultCounter(), cap: env.QLOO_DAILY_CALL_CAP },
    ...overrides,
  });
}
