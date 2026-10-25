/**
 * "Audit any AI's plan": find every cultural entity in a pasted campaign and
 * run the Qloo critic on it against an audience (the same tasteCheck MCP's
 * taste_check uses).
 */
import { createHash } from "node:crypto";
import { z } from "zod";
import type { CacheStore } from "../qloo/cache";
import { qlooBudget, qlooRefusal, type GuardResult } from "../guard";
import { AUDIT_CALL_ESTIMATE } from "../config";
import type { QlooClient, QlooSource } from "../qloo/client";
import type { LLMProvider } from "../llm/types";
import { BriefFields } from "./brief";
import { NoSeedError } from "./context";
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
  return `audit:v2:${createHash("sha256").update(JSON.stringify([norm, llmId, source])).digest("base64url")}`;
}

const CachedAudit = z.object({ receipts: z.array(z.unknown()), metrics: z.object({ picks: z.number() }).loose(), extraction: z.object({ by: z.string() }).loose() }).loose();

/** An earlier identical audit, validated (the cache is external input). */
export async function cachedAudit(cache: CacheStore, key: string): Promise<AuditResult | undefined> {
  const v = await cache.get(key);
  return CachedAudit.safeParse(v).success ? { ...(v as AuditResult), cached: true } : undefined;
}

/** Keeps a finished audit; a degraded one is kept briefly so it is redone soon. */
export async function storeAudit(cache: CacheStore, key: string, r: AuditResult, primary: string): Promise<void> {
  // Anything partial (unscored picks, failed searches, warnings, the model's list not used, answers from a fallback source) is redone soon.
  const degraded = r.metrics.unscored > 0 || r.extraction.fallback !== undefined || (r.extraction.failedSearches ?? 0) > 0 || r.warnings.length > 0 || r.sources.some((x) => x !== primary);
  await cache.set(key, r, degraded ? DEGRADED_AUDIT_TTL : AUDIT_TTL);
}

/** No Qloo call is sent this long after an audit starts, so the reply beats a route's time limit. */
export const AUDIT_DEADLINE_MS = 45_000;

export interface AuditDeps {
  qloo: QlooClient;
  llm: LLMProvider;
  cache: CacheStore;
  ip: string;
  /** Counts the request toward the rate limits and the daily cap (after its budget is reserved). */
  gate: () => Promise<GuardResult>;
  /** Gives back what `gate` counted, when the audit then fails before spending anything. */
  refund?: () => Promise<void>;
}

export type AuditOutcome = { ok: true; result: AuditResult } | { ok: false; refusal: Extract<GuardResult, { ok: false }> };

/**
 * One audit as a public endpoint runs it (/api/audit and MCP's audit_plan): an
 * identical earlier audit is served first, spending nothing; otherwise the
 * Qloo calls are reserved from the caller's share, and only then does the
 * request count toward the rate limits (`gate`). The finished audit is cached.
 */
export async function auditWithBudget(
  input: AuditRequest,
  deps: AuditDeps,
): Promise<AuditOutcome> {
  const { qloo, llm, cache } = deps;
  const key = auditKey(input, llm.id, qloo.primarySource);
  const hit = await cachedAudit(cache, key);
  if (hit) return { ok: true, result: hit };
  // Single flight per input on this instance: concurrent identical audits share the first one's result
  // (or a refusal that isn't about the first caller's own network).
  const pending = auditsInFlight.get(key);
  if (pending) {
    const shared = await pending;
    if (shared.ok || shared.refusal.status !== 429) return shared.ok ? { ok: true, result: { ...shared.result, cached: true } } : shared;
  }
  const run = runAudit(input, deps, key);
  if (!pending) {
    auditsInFlight.set(key, run);
    void run.finally(() => auditsInFlight.delete(key)).catch(() => undefined);
  }
  return run;
}

/** Audits running on this instance, by key. */
const auditsInFlight = new Map<string, Promise<AuditOutcome>>();

async function runAudit(input: AuditRequest, deps: AuditDeps, key: string): Promise<AuditOutcome> {
  const { qloo, llm, cache } = deps;
  const live = qloo.primarySource === "live";
  if (live && !(await qloo.reserve(AUDIT_CALL_ESTIMATE, qlooBudget({ fresh: true }, deps.ip)))) return { ok: false, refusal: qlooRefusal(qloo.refusedBy) };
  try {
    const counted = live || !llm.scripted;
    if (counted) {
      const g = await deps.gate();
      if (!g.ok) return { ok: false, refusal: g };
    }
    qloo.setDeadline(Date.now() + AUDIT_DEADLINE_MS);
    const result = await auditPlan(input, { qloo, llm }).catch(async (err: unknown) => {
      // Nothing to audit against (no audience name resolved): the request cost nothing, so it doesn't count.
      if (counted && err instanceof NoSeedError) await deps.refund?.();
      throw err;
    });
    await storeAudit(cache, key, result, qloo.primarySource);
    return { ok: true, result };
  } finally {
    await qloo.release();
  }
}
