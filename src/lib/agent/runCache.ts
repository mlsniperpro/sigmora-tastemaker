/**
 * The shared "cached run" path for /api/run, /api/ship and MCP. A run's full
 * result is stored once, under its own id (Ship reads it there); the brief's
 * key points at the latest result for that brief. Healthy runs are served for
 * a day, degraded ones (a fallback or a failed step) for ten minutes.
 */
import { z } from "zod";
import { llmFromEnv } from "../llm";
import type { LLMProvider } from "../llm/types";
import { defaultCache, type CacheStore } from "../qloo/cache";
import { qlooFromEnv, type QlooClient } from "../qloo/client";
import { formatZodIssues } from "../zod";
import { Brief, RunRequest } from "./brief";
import { presetById } from "./presets";
import { runTastemaker } from "./run";
import { RUN_SCHEMA_VERSION, type RunEvent, type RunResult } from "./types";
import { hashId } from "./util";

export const RESULT_TTL = 60 * 60 * 24;
export const DEGRADED_TTL = 60 * 10;
/** A shipped campaign is measured days after it posts, so its run is kept that long. */
export const SHIPPED_TTL = 60 * 60 * 24 * 30;

export type ResolvedRequest = { ok: true; brief: Brief; preset: boolean } | { ok: false; status: 400 | 404; error: string };

/** Validates a run request and turns it into a brief, with field-level errors for a bad brief. */
export function resolveRunRequest(raw: unknown): ResolvedRequest {
  const parsed = RunRequest.safeParse(raw);
  if (!parsed.success) {
    // Name the brief's own field errors rather than the union's generic "Invalid input".
    const briefErr = typeof raw === "object" && raw !== null && "brief" in raw ? Brief.safeParse(raw.brief).error : undefined;
    return { ok: false, status: 400, error: formatZodIssues(briefErr ?? parsed.error, { root: "body" }) };
  }
  if ("brief" in parsed.data) return { ok: true, brief: parsed.data.brief, preset: false };
  const preset = presetById(parsed.data.preset);
  return preset ? { ok: true, brief: Brief.parse(preset.brief), preset: true } : { ok: false, status: 404, error: "Unknown preset" };
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

export function isHealthy(r: RunResult): boolean {
  return r.qloo.fallbacks.length === 0 && r.trace.every((s) => s.status === "done");
}

export interface RunDeps {
  qloo: QlooClient;
  llm: LLMProvider;
  cache: CacheStore;
}

/** Cache key for a brief: points at the latest result for it. */
export function runKey(brief: Brief, llmId: string, primarySource: string) {
  return `run:v${RUN_SCHEMA_VERSION}:${hashId(JSON.stringify([brief, llmId, primarySource]))}`;
}

/** Cache key for one run's full result. */
const resultKey = (id: string) => `result:v${RUN_SCHEMA_VERSION}:${id}`;

/** A previously computed run by id (for Ship): the server never trusts client-sent plan text. */
export async function runById(id: string, cache: CacheStore = defaultCache()): Promise<RunResult | undefined> {
  return asRun(await cache.get(resultKey(id)));
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

/** True when an uncached run would spend paid API calls (live Qloo or a real model). */
export const costsMoney = (deps: RunDeps) => deps.qloo.primarySource === "live" || !deps.llm.scripted;

/** Serves a cached result, or runs and stores it. */
export async function getOrRun(lookup: Lookup, emit?: (e: RunEvent) => void): Promise<{ result: RunResult; cached: boolean }> {
  const { brief, key, result: hit, deps } = lookup;
  if (hit) {
    for (const step of hit.trace) emit?.({ type: "step", step });
    emit?.({ type: "result", result: hit });
    return { result: hit, cached: true };
  }
  const result = await runTastemaker(brief, { qloo: deps.qloo, llm: deps.llm, emit });
  await Promise.all([deps.cache.set(resultKey(result.id), result, RESULT_TTL), deps.cache.set(key, { id: result.id }, isHealthy(result) ? RESULT_TTL : DEGRADED_TTL)]);
  return { result, cached: false };
}
