import type { QlooCallMeta, QlooSource } from "../qloo/client";
import type { Draft, Pick } from "../llm/types";
import type { Brief, PickType, Role } from "./brief";

export type Verdict = "pass" | "miss" | "hallucination" | "fading";

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
  /** Explainability: which input signals drove the score. */
  drivers: Driver[];
  /** /v2/trending velocity, -1..1 when known. */
  trend?: number;
  /** Request keys (no credentials) of the Qloo calls behind this receipt. */
  calls: string[];
  source?: QlooSource;
  note: string;
  /** When the critic replaced this pick: what it replaced. */
  replaced?: { name: string; verdict: Verdict; affinity?: number };
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
}

export interface Metrics {
  picks: number;
  hallucinations: number;
  misses: number;
  fading: number;
  /** (hallucinations + misses) / picks */
  cultureMissRate: number;
}

/** Bump when RunResult's shape changes; cache keys carry it, so an older deploy's entries are never served. */
export const RUN_SCHEMA_VERSION = 2;

export interface RunResult {
  id: string;
  version: typeof RUN_SCHEMA_VERSION;
  brief: Brief;
  createdAt: string;
  llm: { id: string; label: string; scripted: boolean };
  sources: QlooSource[];
  qloo: QlooHealth;
  seeds: { name: string; entityId?: string; type?: string }[];
  audience: {
    age: { bucket: string; value: number }[];
    gender: { bucket: string; value: number }[];
    tags: { name: string; affinity: number }[];
  };
  cities: CityScore[];
  heatmap: HeatCell[];
  /** Which signal ranked the metros. */
  citiesRankedBy: "locality" | "heatmap" | "none";
  positioning: { name: string; a: number; b: number; delta: number }[];
  compareTo?: string;
  grounded: PlanSide & { rounds: number };
  baseline: PlanSide;
  metrics: { grounded: Metrics; baseline: Metrics };
  trace: TraceStep[];
}

export type RunEvent =
  | { type: "step"; step: TraceStep }
  | { type: "result"; result: RunResult }
  | { type: "error"; message: string };

export type { Pick };
