/**
 * The Qloo critic: resolve every cultural entity a plan names, score it
 * against the audience, and propose Qloo-preferred replacements for failures.
 * Role rules (types, pass bar, venue/fading checks) come from ROLE_SPEC;
 * results are memoised on the context, so later passes only pay for new names.
 */
import type { Pick as PlanPick, Replacement } from "../llm/types";
import { ROLE_SPEC, type PickType, type Role } from "./brief";
import { isFading, loadTrends, pickKey, resolveByName, resolvedType, scoreEntities, signalFor, type Ctx, type RankedCandidate, type Resolved } from "./context";
import type { Metrics, Receipt, Verdict } from "./types";
import { median, normName, sameName } from "./util";

const r3 = (x: number) => Math.round(x * 1000) / 1000;

/** The affinity a pick needs to pass for its role. */
export function thresholdFor(ctx: Pick<Ctx, "candidates" | "missRatio" | "minAffinity">, role: Role): number {
  const pool = ctx.candidates[role] ?? [];
  if (!pool.length) return 0.5;
  if (ROLE_SPEC[role].bar === "top3") return [...pool].sort((a, b) => b.affinity - a.affinity)[Math.min(2, pool.length - 1)]?.affinity ?? 0.5;
  return r3(Math.max(ctx.minAffinity, ctx.missRatio * median(pool.map((c) => c.affinity))));
}

export function metricsOf(receipts: readonly Receipt[]): Metrics {
  const picks = receipts.length;
  const count = (v: Verdict) => receipts.filter((r) => r.verdict === v).length;
  const hallucinations = count("hallucination");
  const misses = count("miss");
  return { picks, hallucinations, misses, fading: count("fading"), cultureMissRate: picks ? r3((hallucinations + misses) / picks) : 0 };
}

export interface Critique {
  receipts: Receipt[];
  /** Advisory calls that failed (e.g. trending); shown on the trace step. */
  warnings: string[];
}

function uniquePicks(picks: readonly PlanPick[]) {
  const seen = new Set<string>();
  return picks.filter((p) => {
    const k = pickKey(p.role, p.name);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

async function resolvePick(ctx: Ctx, p: PlanPick): Promise<Resolved> {
  const memo = ctx.resolved.get(pickKey(p.role, p.name));
  if (memo) return { ...memo, name: p.name };
  const base = { name: p.name, role: p.role, calls: [] as string[] };
  const known = (ctx.candidates[p.role] ?? []).find((c) => sameName(c.name, p.name));
  let out: Resolved;
  if (known) out = { ...base, entityId: known.entityId, type: known.type };
  else {
    const spec = ROLE_SPEC[p.role];
    const searched: PickType = spec.types.includes(p.type) ? p.type : spec.types[0];
    const { hit, key, source } = await resolveByName(ctx.qloo, p.name, { types: spec.types });
    out = { ...base, entityId: hit?.entity_id, type: hit ? resolvedType(p.role, searched, hit) : searched, calls: [key], source };
  }
  ctx.resolved.set(pickKey(p.role, p.name), out);
  return out;
}

/** Scores every resolved entity not yet scored this run, one insights call per type. */
async function scoreNew(ctx: Ctx, resolved: readonly Resolved[]) {
  const byType = new Map<PickType, Set<string>>();
  for (const r of resolved) {
    if (!r.entityId || ROLE_SPEC[r.role].scoreFromPool || ctx.scores.has(r.entityId)) continue;
    byType.set(r.type, (byType.get(r.type) ?? new Set()).add(r.entityId));
  }
  await Promise.all([...byType].map(([type, set]) => scoreEntities(ctx, type, [...set])));
}

/** Location-bound roles must be in the launch city: ask Qloo with the location filter, once per entity. */
async function checkInCity(ctx: Ctx, resolved: readonly Resolved[]) {
  const ids = [...new Set(resolved.flatMap((r) => (ROLE_SPEC[r.role].inCity && r.entityId && !ctx.inCity.has(r.entityId) ? [r.entityId] : [])))];
  if (!ctx.city || !ids.length) return;
  const res = await ctx.qloo.insights("urn:entity:place", { ...signalFor(ctx), "filter.location.query": ctx.city, "filter.results.entities": ids, take: ids.length });
  const found = new Set((res.data.results.entities ?? []).map((e) => e.entity_id));
  for (const id of ids) ctx.inCity.set(id, { ok: found.has(id), key: res.meta.key });
}

function receiptFor(ctx: Ctx, r: Resolved): Receipt {
  const spec = ROLE_SPEC[r.role];
  const base = { name: r.name, type: r.type, role: r.role, entityId: r.entityId, drivers: [] as Receipt["drivers"], calls: r.calls, source: r.source };
  // A brief that fixes the market only needs the plan to agree with it.
  if (r.role === "city" && ctx.audience.targetCity) {
    const ok = sameName(r.name, ctx.audience.targetCity);
    return { ...base, verdict: ok ? "pass" : "miss", note: ok ? "The brief's target market." : `The brief fixes the market to ${ctx.audience.targetCity}.` };
  }
  if (!r.entityId) return { ...base, verdict: "hallucination", note: `No Qloo entity matches "${r.name}" — the model likely invented it.` };

  const pooled = spec.scoreFromPool ? (ctx.candidates[r.role] ?? []).find((c) => c.entityId === r.entityId) : undefined;
  const scored = spec.scoreFromPool ? undefined : ctx.scores.get(r.entityId);
  const affinity = pooled?.affinity ?? scored?.affinity;
  const threshold = thresholdFor(ctx, r.role);
  const trend = ctx.trends.get(r.entityId);
  const venue = spec.inCity ? ctx.inCity.get(r.entityId) : undefined;
  const calls = [...r.calls, ...[pooled?.key, scored?.key, venue?.key].filter((k): k is string => !!k)];
  const scoredBase = { ...base, affinity: affinity ?? 0, threshold, trend, drivers: scored?.drivers ?? [], calls, source: scored?.source ?? r.source };

  if (affinity === undefined) {
    return { ...scoredBase, verdict: "miss", note: spec.scoreFromPool ? "Not among the candidates Qloo ranked for this audience." : "Qloo returned no affinity for it with this audience." };
  }
  if (venue && !venue.ok) return { ...scoredBase, verdict: "miss", note: `Not in ${ctx.city}: Qloo's location filter doesn't return it there.` };
  if (affinity < threshold) return { ...scoredBase, verdict: "miss", note: `Affinity ${affinity.toFixed(2)} is below the ${threshold.toFixed(2)} bar for this audience.` };
  if (spec.checkFading && trend !== undefined && isFading(ctx, r.entityId)) {
    return { ...scoredBase, verdict: "fading", note: `Fits the audience (${affinity.toFixed(2)}) but its trend is falling (${trend.toFixed(2)}); a hook on it will age badly.` };
  }
  return { ...scoredBase, verdict: "pass", note: `Affinity ${affinity.toFixed(2)} clears the ${threshold.toFixed(2)} bar for this audience.` };
}

export async function critique(ctx: Ctx, picks: readonly PlanPick[]): Promise<Critique> {
  const resolved = await Promise.all(uniquePicks(picks).map((p) => resolvePick(ctx, p)));
  const [, , warnings] = await Promise.all([
    scoreNew(ctx, resolved),
    checkInCity(ctx, resolved),
    loadTrends(
      ctx,
      resolved.flatMap((r) => (r.entityId ? [{ entityId: r.entityId, type: r.type }] : [])),
    ),
  ]);
  return { receipts: resolved.map((r) => receiptFor(ctx, r)), warnings };
}

/**
 * One Qloo-preferred replacement per failing pick. `tried` accumulates every
 * (normalised) name already proposed or rejected across rounds, so the loop
 * never offers the same swap twice.
 */
export function chooseReplacements(ctx: Ctx, picks: readonly PlanPick[], receipts: readonly Receipt[], tried: Set<string>): Replacement[] {
  const used = new Set(picks.map((p) => normName(p.name)));
  const out: Replacement[] = [];
  for (const r of receipts) {
    if (r.verdict === "pass") continue;
    tried.add(normName(r.name));
    const pool: RankedCandidate[] = r.role === "city" && ctx.audience.targetCity ? [] : (ctx.candidates[r.role] ?? []);
    const alt = pool.find((c) => !used.has(normName(c.name)) && !tried.has(normName(c.name)) && !(ROLE_SPEC[r.role].checkFading && isFading(ctx, c.entityId)));
    if (!alt) continue;
    used.add(normName(alt.name));
    tried.add(normName(alt.name));
    const was = r.verdict === "hallucination" ? "isn't a Qloo entity" : r.verdict === "fading" ? `is fading (trend ${r.trend?.toFixed(2)})` : `scores ${r.affinity?.toFixed(2) ?? "below the bar"}`;
    out.push({
      from: r.name,
      to: alt.name,
      type: alt.type,
      role: r.role,
      reason: `Qloo-preferred: ${alt.name} scores ${alt.affinity.toFixed(2)} for this audience; ${r.name} ${was}.`,
    });
  }
  return out;
}
