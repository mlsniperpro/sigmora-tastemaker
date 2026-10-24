/** When a run's numbers may be shown as numbers (the playbook's no-placeholder-numbers rule). */
import type { Receipt, RunResult } from "./types";

/** Why this run's scoreboard must stay blank, or undefined when it is real data from a real model. */
export function placeholderReason(result: Pick<RunResult, "qloo" | "llm">): string | undefined {
  const reasons = [
    ...(result.qloo.simulated > 0 ? ["simulated Qloo data"] : []),
    ...(result.llm.scripted ? ["a scripted stand-in model"] : []),
  ];
  return reasons.length ? `This run used ${reasons.join(" and ")}, so its rates are placeholders and are not shown.` : undefined;
}

/** Entity id → name for everything the run knows by name (seeds, picks, cities), to make the trace readable. */
export function entityNames(result: Pick<RunResult, "seeds" | "cities" | "grounded" | "baseline">): Map<string, string> {
  const named = [...result.seeds, ...result.cities, ...result.grounded.receipts, ...result.baseline.receipts];
  return new Map(named.flatMap((e) => (e.entityId ? [[e.entityId, e.name] as const] : [])));
}

/** One inline line a reader sees next to a failed pick, e.g. "Qloo affinity 0.04 — below all 10 of Qloo's candidates". */
export function annotation(r: Pick<Receipt, "verdict" | "affinity" | "poolRank" | "note">): string {
  if (r.verdict === "pass") return "";
  if (r.affinity === undefined || !r.poolRank) return r.note;
  const { above, of } = r.poolRank;
  const where = above === of ? `below all ${of} of Qloo's candidates for this audience` : above === 0 ? `above all ${of} of Qloo's candidates` : `${above} of Qloo's ${of} candidates score higher`;
  return `Qloo affinity ${r.affinity.toFixed(2)}: ${where}. ${r.note}`;
}
