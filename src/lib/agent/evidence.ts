/** When a run's numbers may be shown as numbers (the playbook's no-placeholder-numbers rule). */
import type { RunResult } from "./types";

/** Why this run's scoreboard must stay blank, or undefined when it is real data from a real model. */
export function placeholderReason(result: Pick<RunResult, "qloo" | "llm">): string | undefined {
  const reasons = [
    ...(result.qloo.simulated > 0 ? ["simulated Qloo data"] : []),
    ...(result.llm.scripted ? ["a scripted stand-in model"] : []),
  ];
  return reasons.length ? `This run used ${reasons.join(" and ")}, so its rates are placeholders and are not shown.` : undefined;
}
