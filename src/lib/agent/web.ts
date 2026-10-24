/**
 * The cross-domain affinity web: the run's inputs (seed entities) on one side,
 * the plan's Qloo-scored picks on the other, and an edge wherever Qloo's
 * explainability says that input drove that pick. Built from data the critic
 * already fetched; no extra calls.
 */
import type { Receipt, RunResult } from "./types";
import { normName } from "./util";

export interface Web {
  inputs: string[];
  picks: Pick<Receipt, "name" | "type" | "role" | "affinity" | "verdict">[];
  /** `weight` is the explainability score of input → pick. */
  edges: { input: number; pick: number; weight: number }[];
}

const TYPE_ORDER = ["artist", "brand", "tv_show", "movie", "podcast", "person", "place", "locality"];

export function affinityWeb(result: Pick<RunResult, "seeds" | "grounded">): Web {
  const inputs = result.seeds.filter((s) => s.entityId).map((s) => s.name);
  const index = new Map(inputs.map((n, i) => [normName(n), i]));
  const picks = result.grounded.receipts
    .filter((r) => r.affinity !== undefined && r.drivers.length > 0)
    .sort((a, b) => TYPE_ORDER.indexOf(a.type) - TYPE_ORDER.indexOf(b.type));
  const edges = picks.flatMap((p, pick) =>
    p.drivers.flatMap((d) => {
      const input = index.get(normName(d.name));
      return input !== undefined && d.score > 0 ? [{ input, pick, weight: d.score }] : [];
    }),
  );
  return { inputs, picks: picks.map(({ name, type, role, affinity, verdict }) => ({ name, type, role, affinity, verdict })), edges };
}
