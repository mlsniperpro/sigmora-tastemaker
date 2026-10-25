/**
 * "Audit any AI's plan": find every cultural entity in a pasted campaign and
 * run the Qloo critic on it against an audience (the same tasteCheck MCP's
 * taste_check uses).
 */
import { z } from "zod";
import type { QlooClient, QlooSource } from "../qloo/client";
import type { LLMProvider } from "../llm/types";
import { BriefFields } from "./brief";
import { extractPicks, MAX_AUDIT_CHARS, MAX_AUDIT_PICKS, MAX_AUDIT_SEARCHES, type Extraction } from "./extract";
import { metricsOf } from "./critic";
import { tasteCheck, type TasteCheckResult } from "./tasteCheck";

/** The audience reuses the Brief's own field rules, so the limits can't drift. */
export const AuditRequest = BriefFields.pick({ ages: true, gender: true })
  .extend({
    text: z.string().trim().min(20, "Paste at least a sentence or two of the plan").max(MAX_AUDIT_CHARS),
    seeds: BriefFields.shape.seeds.min(1),
    city: BriefFields.shape.targetCity,
  })
  .strict();
export type AuditRequest = z.infer<typeof AuditRequest>;

/**
 * Live Qloo calls reserved for one audit (unspent ones go back): the unlabelled-name searches, about two
 * per pick to resolve and score, and up to 30 for the role pools, trend checks and, when the plan names a
 * city, ranking it among the US metros. tests/integration/audit.test.ts holds the sample plan to it.
 */
export const AUDIT_CALL_ESTIMATE = MAX_AUDIT_SEARCHES + 2 * MAX_AUDIT_PICKS + 30;

export interface AuditResult extends TasteCheckResult {
  extraction: Omit<Extraction, "picks">;
  /** Any answer came from the offline simulator: its numbers are placeholders, and the UI prints none. */
  simulated: boolean;
}

export async function auditPlan(input: AuditRequest, opts: { qloo: QlooClient; llm: LLMProvider }): Promise<AuditResult> {
  const sources = new Set<QlooSource>();
  const unobserve = opts.qloo.observe((m) => sources.add(m.source));
  try {
    const { picks, ...extraction } = await extractPicks(input.text, { qloo: opts.qloo, llm: opts.llm, seeds: input.seeds });
    const checked: TasteCheckResult = picks.length
      ? await tasteCheck({ seeds: input.seeds, ages: input.ages, gender: input.gender, city: input.city, picks }, { qloo: opts.qloo })
      : { receipts: [], metrics: metricsOf([]), suggestions: [], sources: [], warnings: [] };
    const all = [...new Set([...sources, ...checked.sources])];
    return { ...checked, sources: all, extraction, simulated: all.includes("simulated") || opts.qloo.primarySource === "simulated" };
  } finally {
    unobserve();
  }
}
