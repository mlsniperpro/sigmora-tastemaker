/** When a run's numbers may be shown as numbers (the playbook's no-placeholder-numbers rule). */
import { presetIdOf } from "./presets";
import type { Receipt, RunResult, Verdict } from "./types";

/** Why this run's scoreboard must stay blank, or undefined when it is real data from a real model. */
export function placeholderReason(result: Pick<RunResult, "qloo" | "llm">): string | undefined {
  const reasons = [
    ...(result.qloo.simulated > 0 ? ["simulated Qloo data"] : []),
    ...(result.llm.scripted ? ["a scripted stand-in model"] : []),
  ];
  return reasons.length ? `This run used ${reasons.join(" and ")}, so its rates are placeholders and are not shown.` : undefined;
}

/**
 * Offline, the scripted model only has sample plans for the presets' categories: on someone's own brief its plan
 * without Qloo has nothing to do with that brief, so it is neither shown nor counted.
 */
export const offBriefBaseline = (result: Pick<RunResult, "llm" | "baseline" | "brief">): boolean =>
  result.llm.scripted && !result.baseline.unavailable && !presetIdOf(result.brief);

/**
 * What the plan without Qloo is when the model is scripted: the stand-in has one fixed plan per kind of
 * launch, whatever the brief's seeds, so a custom brief's baseline isn't an answer to that brief.
 */
export const SCRIPTED_BASELINE = "Scripted stand-in: a fixed sample plan for this category, not a model's answer to your brief.";

/** A rate as a whole percent, or "—" when there is no honest rate to show (too few picks judged). */
export const formatRate = (rate: number | null): string => (rate === null ? "—" : `${Math.round(rate * 100)}%`);

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

/** What a simulated verdict means, in words only: the simulator's numbers are placeholders, so none are printed. */
const SIMULATED_NOTE: Record<Verdict, string> = {
  pass: "Cleared the pass bar for this role in the offline simulator. With a Qloo key, this is checked against Qloo.",
  miss: "Scored below the pass bar for this role in the offline simulator. With a Qloo key, Qloo's affinity decides this.",
  hallucination: "The offline simulator's catalog has no entity by this name. With a Qloo key, this is a search of Qloo's catalog.",
  fading: "Fit the audience in the offline simulator, but its simulated trend is falling.",
  unscored: "The offline simulator gave no score for this pick.",
};

/**
 * The one-line note for a pick; a simulated one gets words with no placeholder numbers. A pick outside the
 * launch city keeps its own note (words only, naming the city), since "scored below the bar" would be wrong.
 */
export const receiptNote = (r: Pick<Receipt, "verdict" | "note" | "outOfCity">, simulated: boolean) => (simulated && !r.outOfCity ? SIMULATED_NOTE[r.verdict] : r.note);
