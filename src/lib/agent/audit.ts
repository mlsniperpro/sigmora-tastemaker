/**
 * "Audit any AI's plan": find every cultural entity in a pasted campaign and
 * run the Qloo critic on it against an audience (the same tasteCheck MCP's
 * taste_check uses).
 */
import { createHash } from "node:crypto";
import { z } from "zod";
import type { CacheStore } from "../qloo/cache";
import type { QlooClient, QlooSource } from "../qloo/client";
import type { LLMProvider } from "../llm/types";
import { BriefFields } from "./brief";
import { extractPicks, MAX_AUDIT_CHARS, squashSpaces, type Extraction } from "./extract";
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

export { AUDIT_CALL_ESTIMATE } from "../config";

export interface AuditResult extends TasteCheckResult {
  /** Served from an earlier identical audit (no Qloo calls spent on this request). */
  cached?: boolean;
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

/** A finished audit is served again for identical input for a day (ten minutes when it was degraded). */
export const AUDIT_TTL = 60 * 60 * 24;
export const DEGRADED_AUDIT_TTL = 60 * 10;

/** Cache key for an audit: the input as audited (spaces squashed), the model and the Qloo source. SHA-256, so no input can collide with another. */
export function auditKey(input: AuditRequest, llmId: string, source: string): string {
  const norm = { ...input, text: squashSpaces(input.text).trim() };
  return `audit:v1:${createHash("sha256").update(JSON.stringify([norm, llmId, source])).digest("base64url")}`;
}

const CachedAudit = z.object({ receipts: z.array(z.unknown()), metrics: z.object({ picks: z.number() }).loose(), extraction: z.object({ by: z.string() }).loose() }).loose();

/** An earlier identical audit, validated (the cache is external input). */
export async function cachedAudit(cache: CacheStore, key: string): Promise<AuditResult | undefined> {
  const v = await cache.get(key);
  return CachedAudit.safeParse(v).success ? { ...(v as AuditResult), cached: true } : undefined;
}

/** Keeps a finished audit; a degraded one (picks unscored, or the model's list failed) is kept briefly so it is redone soon. */
export async function storeAudit(cache: CacheStore, key: string, r: AuditResult): Promise<void> {
  const degraded = r.metrics.unscored > 0 || r.extraction.fallback !== undefined;
  await cache.set(key, r, degraded ? DEGRADED_AUDIT_TTL : AUDIT_TTL);
}
