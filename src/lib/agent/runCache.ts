/**
 * The shared "cached run" path for /api/run, /api/ship and MCP. A run's full
 * result is stored once, under its own id (Ship reads it there); the brief's
 * key points at the latest result for that brief. Healthy runs are served for
 * a day, degraded ones (a fallback or a failed step) for ten minutes.
 */
import { createHash } from "node:crypto";
import { z } from "zod";
import { llmFromEnv } from "../llm";
import type { LLMProvider } from "../llm/types";
import { defaultCache, type CacheStore } from "../qloo/cache";
import { qlooFromEnv, type QlooClient } from "../qloo/client";
import { formatZodIssues } from "../zod";
import { Brief, RunRequest } from "./brief";
import { PRESETS, presetById } from "./presets";
import { runTastemaker } from "./run";
import recorded from "../../../fixtures/runs/recorded.json";
import { RUN_SCHEMA_VERSION, type RunEvent, type RunResult, type Served } from "./types";

/** How long the brief → latest-run pointer serves a healthy run, before a fresh run replaces it. */
export const RESULT_TTL = 60 * 60 * 24;
/** Degraded runs (a fallback or a failed step) are re-run sooner. */
export const DEGRADED_TTL = 60 * 10;
/** A run's own result stays readable by id (permalinks, Ship) through judging, with a margin. */
export const KEEP_TTL = 60 * 60 * 24 * 45;
/** A shipped campaign is measured days after it posts, so shipping renews its run for this long. */
export const SHIPPED_TTL = 60 * 60 * 24 * 30;
/** Seconds a custom run on a keyless deployment is kept (it can be made again for free). */
export const UNMETERED_TTL = 60 * 60;

export type ResolvedRequest = { ok: true; brief: Brief; presetId?: string; fresh: boolean } | { ok: false; status: 400 | 404; error: string };

/** Validates a run request and turns it into a brief, with field-level errors for a bad brief. */
export function resolveRunRequest(raw: unknown): ResolvedRequest {
  const parsed = RunRequest.safeParse(raw);
  if (!parsed.success) {
    // Name the brief's own field errors rather than the union's generic "Invalid input".
    const briefErr = typeof raw === "object" && raw !== null && "brief" in raw ? Brief.safeParse(raw.brief).error : undefined;
    return { ok: false, status: 400, error: formatZodIssues(briefErr ?? parsed.error, { root: "body" }) };
  }
  if ("brief" in parsed.data) return { ok: true, brief: parsed.data.brief, fresh: false };
  const preset = presetById(parsed.data.preset);
  return preset ? { ok: true, brief: Brief.parse(preset.brief), presetId: preset.id, fresh: parsed.data.fresh === true } : { ok: false, status: 404, error: "Unknown preset" };
}

/** Structural check on cached values (they come from our own store, but KV is still external input). */
const CachedRun = z
  .object({
    id: z.string(),
    version: z.literal(RUN_SCHEMA_VERSION),
    trace: z.array(z.object({ id: z.string(), status: z.string() }).loose()),
    grounded: z.object({ draft: z.object({ captions: z.array(z.unknown()) }).loose(), receipts: z.array(z.unknown()) }).loose(),
    baseline: z.object({ receipts: z.array(z.unknown()) }).loose(),
    qloo: z.object({ fallbacks: z.array(z.unknown()) }).loose(),
  })
  .loose();
const Pointer = z.object({ id: z.string() });

/** Validates without reshaping: a passing value is returned exactly as stored. */
function asRun(value: unknown): RunResult | undefined {
  return CachedRun.safeParse(value).success ? (value as RunResult) : undefined;
}

/**
 * A run worth serving for a day: no fallbacks, every step done, and every pick
 * judged (a run cut short by the Qloo budget or deadline leaves picks unscored,
 * and must not replace a complete result for everyone for 24 hours).
 */
export function isHealthy(r: RunResult): boolean {
  return r.qloo.fallbacks.length === 0 && r.trace.every((s) => s.status === "done") && r.metrics.grounded.unscored === 0 && r.metrics.baseline.unscored === 0;
}

export interface RunDeps {
  qloo: QlooClient;
  llm: LLMProvider;
  cache: CacheStore;
}

/** Cache key for a brief: points at the latest result for it. */
export function runKey(brief: Brief, llmId: string, primarySource: string) {
  // SHA-256, so no crafted brief can collide with a preset's key and take over what it serves.
  return `run:v${RUN_SCHEMA_VERSION}:${createHash("sha256").update(JSON.stringify([brief, llmId, primarySource])).digest("base64url")}`;
}

/** The latest finished run for a brief key, kept as long as runs are: served (labelled) when a new run is refused. */
const lastKey = (key: string) => `last:${key}`;

/** Cache key for one run's full result. */
const resultKey = (id: string) => `result:v${RUN_SCHEMA_VERSION}:${id}`;

/** Recorded live runs, one per preset (`pnpm runs:record` writes them). Only current-schema runs count. */
export function recordedRuns(store: Record<string, unknown> = recorded): Map<string, RunResult> {
  return new Map(Object.entries(store).flatMap(([preset, v]) => {
    const run = asRun(v);
    return run ? [[preset, run] as const] : [];
  }));
}

/** A previously computed run by id (permalinks, Ship): the server never trusts client-sent plan text. */
export async function runById(id: string, cache: CacheStore = defaultCache(), recordings: ReadonlyMap<string, RunResult> = recordedRuns()): Promise<RunResult | undefined> {
  return asRun(await cache.get(resultKey(id))) ?? [...recordings.values()].find((r) => r.id === id);
}

/** True when `brief` is exactly one of the presets' briefs (our own text, never a visitor's). */
export function isPresetBrief(brief: Brief): boolean {
  const json = JSON.stringify(brief);
  return PRESETS.some((p) => JSON.stringify(Brief.parse(p.brief)) === json);
}

const ownerRunKey = (id: string) => `owner-run:v${RUN_SCHEMA_VERSION}:${id}`;

/** Records that the signed-in owner was served this run (from their own brief), so it may ship to real channels. */
export async function markOwnerRun(id: string, cache: CacheStore = defaultCache()): Promise<void> {
  await cache.set(ownerRunKey(id), { owner: true }, KEEP_TTL);
}

/**
 * Whether a run may go to real channels: it came from a preset (our own text) or
 * was served to the signed-in owner. A permalink to someone else's brief can't
 * get its text posted as the brand just because the owner clicked Ship on it.
 */
export async function shippableByOwner(run: RunResult, cache: CacheStore = defaultCache()): Promise<boolean> {
  if (isPresetBrief(run.brief)) return true;
  return OwnerMark.safeParse(await cache.get(ownerRunKey(run.id))).success;
}
const OwnerMark = z.object({ owner: z.literal(true) });

/**
 * Keeps a fallback run (a preset on the offline simulator): by id for a day, so its permalink opens, and briefly as
 * the brief's last run, so refused clicks replay it. No brief's fresh-result pointer ever names it.
 */
export async function keepFallbackRun(run: RunResult, key: string, cache: CacheStore = defaultCache()): Promise<void> {
  await Promise.all([cache.set(resultKey(run.id), run, RESULT_TTL), cache.set(lastKey(key), { id: run.id }, DEGRADED_TTL)]);
}

/**
 * How to label a run served again: a run made on the simulator while this deployment answers from live Qloo
 * was a fallback (live Qloo failed or was refused), and says so instead of claiming the deployment has no key.
 */
export function servedAs(run: RunResult, from: Served["from"], reason: string, deps: { qloo: Pick<RunDeps["qloo"], "primarySource"> }): Served {
  return run.qloo.simulated > 0 && deps.qloo.primarySource === "live" ? { from: "simulated", reason } : { from, reason };
}

/** Keeps a run that was shipped for real until its campaign can be measured. */
export async function keepShippedRun(run: RunResult, cache: CacheStore = defaultCache()): Promise<void> {
  await cache.set(resultKey(run.id), run, SHIPPED_TTL);
}

export interface Lookup {
  brief: Brief;
  key: string;
  result?: RunResult;
  deps: RunDeps;
}

export async function cachedRun(brief: Brief, deps: Partial<RunDeps> = {}): Promise<Lookup> {
  const d: RunDeps = { qloo: deps.qloo ?? qlooFromEnv(), llm: deps.llm ?? llmFromEnv(), cache: deps.cache ?? defaultCache() };
  const key = runKey(brief, d.llm.id, d.qloo.primarySource);
  const ptr = Pointer.safeParse(await d.cache.get(key));
  return { brief, key, result: ptr.success ? await runById(ptr.data.id, d.cache) : undefined, deps: d };
}

/**
 * The latest finished run for this brief, however old (the pointer that serves
 * repeat requests expires after a day, or ten minutes for a degraded run). Used
 * only when a new run is refused, and labelled as such, so a cold preset with no
 * recording shows its last result instead of an error.
 */
export async function lastRun(lookup: Pick<Lookup, "key" | "deps">): Promise<RunResult | undefined> {
  const ptr = Pointer.safeParse(await lookup.deps.cache.get(lastKey(lookup.key)));
  return ptr.success ? runById(ptr.data.id, lookup.deps.cache) : undefined;
}

/** True when an uncached run would spend paid API calls (live Qloo or a real model). */
export const costsMoney = (deps: RunDeps) => deps.qloo.primarySource === "live" || !deps.llm.scripted;

/** Replays a finished run as events: its trace, then the result, labelled with where it came from. */
export function replay(result: RunResult, served: Served, emit?: (e: RunEvent) => void): RunResult {
  for (const step of result.trace) emit?.({ type: "step", step });
  emit?.({ type: "result", result, served });
  return result;
}

interface InFlight {
  done: Promise<RunResult>;
  events: RunEvent[];
  listeners: Set<(e: RunEvent) => void>;
}
/** Runs in progress on this instance, by brief key: a second request for the same cold brief joins the first. */
const inFlight = new Map<string, InFlight>();

/** True when this instance is already running this brief: a request for it joins that run and spends nothing. */
export const isInFlight = (key: string) => inFlight.has(key);

/**
 * Serves a cached result, or runs and stores it. Identical concurrent requests
 * share one run (they get its events so far, then the rest live). When the run
 * fails and a `fallback` recording exists, that is served instead, with the reason.
 */
export async function getOrRun(lookup: Lookup, emit?: (e: RunEvent) => void, fallback?: RunResult): Promise<{ result: RunResult; served?: Served }> {
  const { brief, key, result: hit, deps } = lookup;
  if (hit) return { result: replay(hit, { from: "cache" }, emit), served: { from: "cache" } };

  let flight = inFlight.get(key);
  if (!flight) {
    const events: RunEvent[] = [];
    const listeners = new Set<(e: RunEvent) => void>();
    const fanOut = (e: RunEvent) => {
      events.push(e);
      for (const l of listeners) l(e);
    };
    const done = runTastemaker(brief, { qloo: deps.qloo, llm: deps.llm, emit: fanOut }).then(async (result) => {
      // A keyless deployment's custom runs cost nothing to make again, so they aren't kept for weeks.
      const keep = costsMoney(deps) || isPresetBrief(brief) ? KEEP_TTL : UNMETERED_TTL;
      const healthy = isHealthy(result) && deps.qloo.notFound === 0;
      // A degraded run (a "Re-run live" that hit a blip) doesn't replace a healthy result other visitors are served.
      const replacesHealthy = !healthy && (await deps.cache.get(key)) !== undefined;
      await Promise.all([
        deps.cache.set(resultKey(result.id), result, keep),
        ...(replacesHealthy ? [] : [deps.cache.set(key, { id: result.id }, healthy ? RESULT_TTL : DEGRADED_TTL)]),
        ...(replacesHealthy ? [] : [deps.cache.set(lastKey(key), { id: result.id }, keep)]),
      ]);
      return result;
    });
    flight = { done, events, listeners };
    inFlight.set(key, flight);
    void done.then(
      () => inFlight.delete(key),
      () => inFlight.delete(key),
    );
  }
  if (emit) {
    for (const e of flight.events) emit(e);
    flight.listeners.add(emit);
  }
  try {
    return { result: await flight.done };
  } catch (err) {
    if (!fallback) throw err;
    const reason = `the live run failed (${err instanceof Error ? err.message : String(err)})`;
    return { result: replay(fallback, { from: "recording", reason }, emit), served: { from: "recording", reason } };
  } finally {
    if (emit) flight.listeners.delete(emit);
  }
}
