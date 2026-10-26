import type { z } from "zod";
import recorded from "../../../fixtures/qloo/recorded.json";
import { loadConfig } from "../config";
import { budgetCounter, incrDaily, type Counter } from "../counter";
import { DEFAULT_RETRY, HttpError, ensureOk, fetchWithTimeout, joinUrl, withRetry, type RetryPolicy } from "../net";
import { formatZodIssues, wellFormed } from "../zod";
import { defaultCache, type CacheStore } from "./cache";
import { QlooBudgetError, QlooDeadlineError, QlooSchemaError } from "./errors";
import { assertParams, requestKey, type QlooParams, type QlooPath } from "./params";
import { simulate } from "./sim/simulator";
import { Throttle } from "./throttle";
import {
  CompareResponse,
  InsightsResponse,
  SearchResponse,
  TrendingResponse,
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
/** An empty reply may be a transient miss (or a dropped parameter that gets fixed): keep it briefly. */
export const EMPTY_TTL = 60 * 10;
const SERVICE = "Qloo";

/** Calls whose 404 means "no results" rather than an error (docs.qloo.com: get-search, get-entities, analysis-compare). */
const NOT_FOUND_IS_EMPTY: ReadonlySet<QlooPath> = new Set(["/search", "/entities", "/v2/analysis/compare"]);

/** The reply a "no results" 404 stands for. */
const NOT_FOUND = { results: [] } as const;

/** True when a reply carries no results at all: `results` is an empty array, or an object whose lists are all empty. */
export function isEmptyReply(raw: unknown): boolean {
  if (!raw || typeof raw !== "object") return true;
  const results = (raw as { results?: unknown }).results;
  if (results === undefined || results === null) return true;
  if (Array.isArray(results)) return results.length === 0;
  if (typeof results !== "object") return false;
  return Object.values(results).every((v) => !Array.isArray(v) || v.length === 0);
}

/** The trending window's date params; a recorded series stands in for a later window of the same entity. */
const TREND_DATES = ["filter.start_date", "filter.end_date"];

/** Fixture key with the trending window removed, so a recording from an earlier week still answers. */
export function trendFamily(key: string): string | undefined {
  if (!key.startsWith("/v2/trending?")) return undefined;
  const q = new URLSearchParams(key.slice("/v2/trending?".length));
  for (const d of TREND_DATES) q.delete(d);
  return requestKey("/v2/trending", Object.fromEntries(q));
}

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
    // Model-written names reach queries: a lone surrogate in one would make the URL (and the cache key) unencodable.
    const clean = Array.isArray(v) ? v.map((x) => (typeof x === "string" ? wellFormed(x) : x)) : typeof v === "string" ? wellFormed(v) : v;
    out[k] = Array.isArray(clean) && SET_PARAMS.includes(k) ? [...clean].sort() : clean;
  }
  if (out["filter.type"] === "urn:entity:person") {
    delete out["signal.demographics.age"];
    delete out["signal.demographics.gender"];
  }
  return out;
}

let sharedThrottle: Throttle | undefined;

/** How long a share that refused a reservation is refused again without asking the store. */
export const SPENT_MEMO_MS = 60_000;
const memos = new WeakMap<Counter, Map<string, number>>();
/** Per counter (so separate stores never share a memo): "share|cap|day|calls" → refused-until (epoch ms). Bounded, and cleared by refunds. */
function spentMemo(counter: Counter): Map<string, number> {
  let m = memos.get(counter);
  if (!m) {
    m = new Map();
    memos.set(counter, m);
  }
  if (m.size > 5000) for (const [k, until] of m) if (until <= Date.now()) m.delete(k);
  return m;
}

const refundTimes = new WeakMap<Counter, Map<string, number>>();
/** Per counter: share name → when calls were last handed back to it (bounded by the number of shares). */
function refundedAt(counter: Counter): Map<string, number> {
  let m = refundTimes.get(counter);
  if (!m) {
    m = new Map();
    refundTimes.set(counter, m);
  }
  if (m.size > 5000) m.clear();
  return m;
}

export interface ReserveOptions {
  /**
   * Daily shares the calls also count against, each with its own cap: a pool
   * (presets vs. custom briefs, which split the day so neither can starve the
   * other), one network, one preset.
   */
  scopes?: { key: string; cap: number }[];
}

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
  private reservation: { at: number; scopes: { name: string; cap: number }[] } | undefined;
  /** Which daily share refused the last reserve() ("qloo-calls" for the whole day), or undefined when it didn't refuse. */
  refusedBy: string | undefined;
  /** The shares calls past the reservation are charged to (kept after release, for a client that keeps calling). */
  private shares: { name: string; cap: number }[] = [];
  /** Lookups this client read as "no results" from a 404 (not cached; a job that saw one is kept only briefly). */
  notFound = 0;
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
    const fixtureKey = this.fixtureKey(key);
    const hasFixture = fixtureKey !== undefined;

    if (this.primarySource === "live") {
      try {
        const live = await this.getLive(path, clean, key, schema);
        return done(this.parse(path, schema, live.raw), "live", live.cached);
      } catch (err) {
        if (this.mode === "live" || !hasFixture) throw err;
        const reason = err instanceof Error ? err.message : String(err);
        console.warn(`[qloo] live call failed, using the recorded response: ${reason}`);
        return done(this.parse(path, schema, this.fixtures[fixtureKey]), "replay", false, reason);
      }
    }
    if (hasFixture) return done(this.parse(path, schema, this.fixtures[fixtureKey]), "replay", false);
    return done(this.parse(path, schema, simulate(path, clean)), "simulated", false);
  }

  /**
   * The recorded response for a request: the exact key, or for /v2/trending the
   * newest recording of the same entity and type (the date window moves weekly).
   */
  private fixtureKey(key: string): string | undefined {
    if (key in this.fixtures) return key;
    const family = trendFamily(key);
    if (!family) return undefined;
    const end = (k: string) => new URLSearchParams(k.split("?")[1] ?? "").get("filter.end_date") ?? "";
    return Object.keys(this.fixtures)
      .filter((k) => trendFamily(k) === family)
      .sort((a, b) => (end(a) < end(b) ? 1 : end(a) > end(b) ? -1 : 0))[0];
  }

  private parse<S extends z.ZodType>(path: string, schema: S, raw: unknown): z.infer<S> {
    const r = schema.safeParse(raw);
    if (!r.success) throw new QlooSchemaError(path, formatZodIssues(r.error, { max: 3 }));
    return r.data;
  }

  private getLive(path: QlooPath, params: QlooParams, key: string, schema: z.ZodType) {
    const pending = this.inFlight.get(key);
    if (pending) return pending;
    const p = this.fetchLive(path, params, key, schema).finally(() => this.inFlight.delete(key));
    this.inFlight.set(key, p);
    return p;
  }

  /**
   * A cached reply, or a fetched one. Only replies that pass the schema are
   * cached or recorded: a malformed 200 must not be served for a week, or
   * become a replay fixture. A cached entry that no longer passes is refetched.
   */
  private async fetchLive(path: QlooPath, params: QlooParams, key: string, schema: z.ZodType): Promise<{ raw: unknown; cached: boolean }> {
    const hit = await this.cache.get(key);
    if (hit !== undefined && schema.safeParse(hit).success) return { raw: hit, cached: true };
    // Every network attempt, retries included, is paid for from the budget.
    const raw = await withRetry(async () => {
      await this.spendBudget();
      return this.fetchOnce(path, params);
    }, this.opts.retry ?? DEFAULT_RETRY).catch((err: unknown) => {
      // These calls answer "no results" with a 404 (see NOT_FOUND_IS_EMPTY): that's a finding
      // (the name isn't in Qloo), not a failure, so it reads as an empty list and is cached as one.
      if (err instanceof HttpError && err.status === 404 && NOT_FOUND_IS_EMPTY.has(path)) return NOT_FOUND;
      throw err;
    });
    this.parse(path, schema, raw);
    // A 404 can also come from a gateway or a deploy, not Qloo's catalog: it's read as "no results" but never cached,
    // and the job that saw one is stored only briefly (`notFound`), so a blip can't stand as a verdict for a day.
    if (raw === NOT_FOUND) {
      this.notFound++;
      return { raw: { results: [] }, cached: false };
    }
    await this.cache.set(key, raw, isEmptyReply(raw) ? EMPTY_TTL : TTL);
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
    if (!daily) return;
    // Past the reservation, each call is charged to the day and to every share the job reserved from.
    const counters = [{ name: "qloo-calls", cap: daily.cap }, ...this.shares];
    const at = Date.now();
    const taken: string[] = [];
    try {
      for (const c of counters) {
        const n = await incrDaily(daily.counter, c.name, at);
        taken.push(c.name);
        if (n > c.cap) {
          await this.giveBack(taken, at, 1, false);
          throw new QlooBudgetError("day", c.cap);
        }
      }
    } catch (err) {
      if (err instanceof QlooBudgetError) throw err;
      // Fail closed: an unreadable budget is treated as a spent one (the run degrades to unscored picks).
      await this.giveBack(taken, at, 1, false);
      throw new QlooBudgetError("day", daily.cap);
    }
  }

  /**
   * Takes `calls` out of today's live budget up front, in one atomic step per
   * counter, so a job that starts can finish: concurrent jobs can't all pass a
   * check and then run dry half-way. False (and nothing taken) when today's
   * budget or any of `scopes` can't cover it, or when the budget store can't be
   * read (fail closed: an unreadable budget never means an unlimited one).
   * Free when this client makes no live calls. One reservation per client
   * (each run gets a fresh client).
   */
  async reserve(calls: number, opts: ReserveOptions = {}): Promise<boolean> {
    const daily = this.opts.daily;
    if (!daily || this.primarySource !== "live" || calls <= 0) return true;
    const at = Date.now();
    const shares = (opts.scopes ?? []).map((s) => ({ name: `qloo-scope:${s.key}`, cap: s.cap })).reverse();
    const counters = [...shares, { name: "qloo-calls", cap: daily.cap }];
    // A share that refused moments ago is refused again without a round trip, so a flood of refused requests costs the store nothing.
    const memo = spentMemo(daily.counter);
    const day = new Date(at).toISOString().slice(0, 10);
    // Keyed by the share's cap, the UTC day and the size asked for: a new day, a bigger cap or a smaller request
    // (a 14-call taste check after a refused 80-call run) is asked afresh.
    const memoKey = (c: { name: string; cap: number }) => `${c.name}|${String(c.cap)}|${day}|${String(calls)}`;
    const recent = counters.find((c) => (memo.get(memoKey(c)) ?? 0) > at);
    if (recent) {
      this.refusedBy = recent.name.replace(/^qloo-scope:/, "");
      return false;
    }
    const taken: string[] = [];
    try {
      for (const c of counters) {
        const n = await incrDaily(daily.counter, c.name, at, calls);
        taken.push(c.name);
        if (n > c.cap) {
          await this.giveBack(taken, at, calls, false);
          // Unless another job refunded this share since the count was taken (the room may be back already).
          if ((refundedAt(daily.counter).get(c.name) ?? 0) < at) memo.set(memoKey(c), at + SPENT_MEMO_MS);
          this.refusedBy = c.name.replace(/^qloo-scope:/, "");
          return false;
        }
      }
    } catch (err) {
      console.error(`[qloo] budget store unavailable, refusing the run: ${err instanceof Error ? err.message : String(err)}`);
      this.refusedBy = "store";
      await this.giveBack(taken, at, calls, false);
      return false;
    }
    this.prepaid += calls;
    this.shares = shares.reverse();
    this.reservation = { at, scopes: this.shares };
    return true;
  }

  /** Gives back whatever reserve() took and the job didn't spend, to the day it was taken from. */
  async release(): Promise<void> {
    const unspent = this.prepaid;
    const r = this.reservation;
    this.prepaid = 0;
    this.reservation = undefined;
    if (unspent <= 0 || !r) return;
    await this.giveBack(["qloo-calls", ...r.scopes.map((x) => x.name)], r.at, unspent);
  }

  /** Best effort: a refund the store refuses is logged; the day's window expires on its own. */
  /** `stamp`: a real refund of reserved calls (false for undoing a refused reservation's own increments, which frees nothing). */
  private async giveBack(names: readonly string[], at: number, calls: number, stamp = true) {
    const daily = this.opts.daily;
    if (!daily) return;
    // Calls handed back may make room again: drop the refusal memo for these shares, and note when.
    const memo = spentMemo(daily.counter);
    for (const key of memo.keys()) if (names.some((n) => key.startsWith(`${n}|`))) memo.delete(key);
    if (stamp) {
      const refunds = refundedAt(daily.counter);
      const when = Date.now();
      for (const n of names) refunds.set(n, when);
    }
    for (const name of names) {
      try {
        await incrDaily(daily.counter, name, at, -calls);
      } catch (err) {
        console.error(`[qloo] couldn't refund ${calls} calls to ${name}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
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
        // No redirects: the API key header must never follow a reply to another origin.
        { method: "GET", headers: { "X-Api-Key": apiKey, Accept: "application/json" }, cache: "no-store", redirect: "error" },
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

  /** One entity's weekly series over [start, end] (YYYY-MM-DD, both required by the docs). */
  trending(type: EntityType, entityId: string, window: { start: string; end: string }) {
    return this.get(
      "/v2/trending",
      { "filter.type": entityUrn(type), "signal.interests.entities": [entityId], "filter.start_date": window.start, "filter.end_date": window.end },
      TrendingResponse,
    );
  }

  /** Genre tags (filter.subtype=urn:tag:genre, documented) where audience a and audience b differ. */
  compare(a: string[], b: string[], take = 10) {
    return this.get(
      "/v2/analysis/compare",
      { "a.signal.interests.entities": a, "b.signal.interests.entities": b, "filter.subtype": "urn:tag:genre", take },
      CompareResponse,
    );
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
    daily: { counter: budgetCounter(), cap: env.QLOO_DAILY_CALL_CAP },
    ...overrides,
  });
}
