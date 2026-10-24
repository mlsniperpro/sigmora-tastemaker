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
  status: "done" | "error" | "skipped";
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

export interface RunResult {
  id: string;
  version: 1;
  brief: Brief;
  createdAt: string;
  llm: { id: string; label: string; scripted: boolean };
  sources: QlooSource[];
  seeds: { name: string; entityId?: string; type?: string }[];
  audience: {
    age: { bucket: string; value: number }[];
    gender: { bucket: string; value: number }[];
    tags: { name: string; affinity: number }[];
  };
  cities: CityScore[];
  heatmap: { name?: string; lat: number; lon: number; affinity: number }[];
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
