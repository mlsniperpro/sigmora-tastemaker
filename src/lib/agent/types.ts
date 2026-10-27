import type { QlooCallMeta, QlooSource } from "../qloo/client";
import type { Draft, Pick } from "../llm/types";
import type { Brief, PickType, Role } from "./brief";

/**
 * "hallucination": no Qloo entity matches the name in a typed or an untyped search.
 * "unscored": real, but Qloo gave no affinity to judge it by (no pool, no score, or the run's budget ran out);
 * left out of the miss rate, and never counted as a pass.
 */
export type Verdict = "pass" | "miss" | "hallucination" | "fading" | "unscored";

export interface Driver {
  name: string;
  score: number;
}

/** Evidence attached to one cultural pick. */
export interface Receipt {
  name: string;
  type: PickType;
  role: Role;
  verdict: Verdict;
  entityId?: string;
  affinity?: number;
  threshold?: number;
  /** Median affinity of Qloo's candidates for the role, when the bar is drawn from it (for sensitivity analysis). */
  poolMedian?: number;
  /** Where the pick's affinity falls among Qloo's own candidates for the role: how many of them score higher. */
  poolRank?: { above: number; of: number };
  /** Explainability: which input signals drove the score. */
  drivers: Driver[];
  /** Qloo's `query.explainability.warning`: it scored the pick but couldn't split the score by signal, so `drivers` is empty. */
  explainabilityWarning?: string;
  /** Newest /v2/trending `population_percent_delta` for the entity, when Qloo has a series for it. */
  trend?: number;
  /** Request keys (no credentials) of the Qloo calls behind this receipt. */
  calls: string[];
  source?: QlooSource;
  note: string;
  /** When the critic replaced this pick: what it replaced. */
  replaced?: { name: string; verdict: Verdict; affinity?: number };
  /**
   * A location-bound pick the location filter doesn't place in the plan's city: that city. Its note says so
   * in words only (no placeholder numbers), so it is shown as is on simulated data too.
   */
  outOfCity?: string;
}

export interface TraceStep {
  id: string;
  title: string;
  detail: string;
  status: "done" | "error";
  ms: number;
  calls: QlooCallMeta[];
  /** For LLM steps. */
  model?: string;
}

export interface CityScore {
  name: string;
  entityId?: string;
  affinity: number;
  lat?: number;
  lon?: number;
}

export interface HeatCell {
  lat: number;
  lon: number;
  affinity: number;
}

/** Where this run's Qloo answers came from, and every live failure that forced a fallback. */
export interface QlooHealth {
  calls: number;
  live: number;
  cached: number;
  replay: number;
  simulated: number;
  /** Calls answered by a recorded response because live failed. */
  fallbackCalls: number;
  /** Distinct fallback reasons with counts; empty when nothing fell back. */
  fallbacks: { reason: string; count: number }[];
}

export interface PlanSide {
  draft: Draft;
  receipts: Receipt[];
  /** Set when this side couldn't be produced (e.g. the baseline draft failed); the draft is then empty. */
  unavailable?: string;
}

export interface Metrics {
  picks: number;
  /** Picks Qloo could judge (picks − unscored). */
  judged: number;
  hallucinations: number;
  misses: number;
  fading: number;
  /** Picks Qloo couldn't score; excluded from the rate's denominator. */
  unscored: number;
  /** (hallucinations + misses) / judged; null when fewer than half the picks were judged (shown as "—"). */
  cultureMissRate: number | null;
}

/** Bump when RunResult's shape changes; cache keys carry it, so an older deploy's entries are never served. */
export const RUN_SCHEMA_VERSION = 6;

export interface RunResult {
  id: string;
  version: typeof RUN_SCHEMA_VERSION;
  brief: Brief;
  createdAt: string;
  /** Wall-clock time of the whole run, measured. */
  durationMs: number;
  llm: { id: string; label: string; scripted: boolean };
  sources: QlooSource[];
  qloo: QlooHealth;
  seeds: { name: string; entityId?: string; type?: string }[];
  audience: {
    age: { bucket: string; value: number }[];
    gender: { bucket: string; value: number }[];
    /** The vocabulary is the names; an affinity is shown when Qloo returns one (its urn:tag example returns none). */
    tags: { name: string; affinity?: number }[];
  };
  cities: CityScore[];
  heatmap: HeatCell[];
  /** Which signal ranked the metros. */
  /** "in-city": the brief fixes the market, and the heatmap shows where inside it the audience is. */
  citiesRankedBy: "heatmap" | "in-city" | "none";
  positioning: { name: string; a: number; b: number; delta: number }[];
  compareTo?: string;
  grounded: PlanSide & { rounds: number };
  baseline: PlanSide;
  metrics: { grounded: Metrics; baseline: Metrics };
  trace: TraceStep[];
}

/**
 * Where a result that wasn't computed for this request came from:
 * "cache" = the same brief ran before; "recording" = a recorded live run of the preset;
 * "simulated" = live Qloo failed with nothing recorded, so the preset ran on the labelled offline simulator.
 * `reason` says why it was served instead of a new run (a refused or failed live run).
 */
export type Served = { from: "cache" | "recording" | "simulated"; reason?: string };

export type RunEvent =
  /** A step began; the trace shows it as running until its "step" event arrives. */
  | { type: "start"; id: string; title: string }
  | { type: "step"; step: TraceStep }
  /** `served`: the result is an earlier run (its trace is a replay of that run), and why it was served. */
  | { type: "result"; result: RunResult; served?: Served }
  | { type: "error"; message: string };

export type { Pick };
