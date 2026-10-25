/**
 * The Qloo critic: resolve every cultural entity a plan names, score it
 * against the audience, and propose Qloo-preferred replacements for failures.
 * Role rules (types, pass bar, venue/fading checks) come from ROLE_SPEC;
 * results are memoised on the context, so later passes only pay for new names.
 */
import type { Pick as PlanPick, Replacement } from "../llm/types";
import { isQlooStop } from "../qloo/errors";
import { ROLE_SPEC, type PickType, type Role } from "./brief";
import { entityTypesOf, inCityKey, isFading, pickKey, readTrends, resolveByName, resolvedType, scoreEntities, signalFor, type Ctx, type Resolved } from "./context";
import type { Metrics, Receipt, Verdict } from "./types";
import { median, normName, sameName } from "./util";

const r3 = (x: number) => Math.round(x * 1000) / 1000;

/** The affinity a pick needs to pass for its role; undefined when Qloo returned no pool to set a bar from. */
export function thresholdFor(ctx: Pick<Ctx, "candidates" | "missRatio" | "minAffinity">, role: Role): number | undefined {
  const pool = ctx.candidates[role] ?? [];
  if (!pool.length) return undefined;
  if (ROLE_SPEC[role].bar === "top3") return [...pool].sort((a, b) => b.affinity - a.affinity)[Math.min(2, pool.length - 1)]?.affinity;
  return r3(Math.max(ctx.minAffinity, ctx.missRatio * median(pool.map((c) => c.affinity))));
}

/**
 * Counts per verdict, and the Culture Miss Rate over the picks Qloo could
 * judge. The rate is null (shown as "—") when fewer than half the picks were
 * judged: a rate over a sliver of the plan, or over nothing, would read as a
 * real 0% it isn't.
 */
export function metricsOf(receipts: readonly Receipt[]): Metrics {
  const picks = receipts.length;
  const count = (v: Verdict) => receipts.filter((r) => r.verdict === v).length;
  const hallucinations = count("hallucination");
  const misses = count("miss");
  const unscored = count("unscored");
  const judged = picks - unscored;
  const rated = judged > 0 && judged * 2 >= picks;
  return { picks, judged, hallucinations, misses, fading: count("fading"), unscored, cultureMissRate: rated ? r3((hallucinations + misses) / judged) : null };
}

export interface Critique {
  receipts: Receipt[];
  /** Advisory calls that failed (trending) for a reason other than the run's budget or time; shown on the trace step. */
  warnings: string[];
  /**
   * Set when the run's Qloo budget or time ran out during this pass: why. Only
   * the picks whose own calls were refused are unscored ("Not checked"); the
   * rest are judged from what the run already holds.
   */
  cut?: string;
}

/** Calls this pass sent that the run's Qloo budget or time refused, per entity id: the reason. */
interface Refused {
  score: Map<string, string>;
  venue: Map<string, string>;
  trend: Map<string, string>;
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
    const typed = await resolveByName(ctx.qloo, p.name, { types: spec.types, titlePart: true });
    if (typed.hit) {
      out = { ...base, entityId: typed.hit.entity_id, type: resolvedType(p.role, searched, typed.hit), calls: [typed.key], source: typed.source, ...(typed.partOf ? { matchedAs: typed.partOf } : {}) };
    } else {
      // Before calling a name invented, look across every type: it may be real but filed elsewhere.
      const any = await resolveByName(ctx.qloo, p.name, { take: 10 });
      const otherType = any.hit ? entityTypesOf(any.hit)[0] : undefined;
      out = { ...base, type: searched, calls: [typed.key, any.key], source: any.source, ...(any.hit ? { filedAs: otherType ?? "another type" } : {}) };
    }
  }
  ctx.resolved.set(pickKey(p.role, p.name), out);
  return out;
}

/**
 * Scores every resolved entity not yet scored (or already left out) this run,
 * one insights call per type. A type whose call the run's budget or time
 * refused is recorded in `refused`; any other failure throws.
 */
async function scoreNew(ctx: Ctx, resolved: readonly Resolved[], refused: Map<string, string>) {
  const byType = new Map<PickType, Set<string>>();
  for (const r of resolved) {
    if (!r.entityId || ROLE_SPEC[r.role].scoreFromPool || ctx.scores.has(r.entityId) || ctx.omitted.has(r.entityId)) continue;
    byType.set(r.type, (byType.get(r.type) ?? new Set()).add(r.entityId));
  }
  const groups = [...byType];
  const settled = await Promise.allSettled(groups.map(([type, set]) => scoreEntities(ctx, type, [...set])));
  settled.forEach((s, i) => {
    if (s.status === "fulfilled") return;
    if (!isQlooStop(s.reason)) throw s.reason;
    for (const id of groups[i]?.[1] ?? []) refused.set(id, s.reason.message);
  });
}

/**
 * Location-bound roles must be in the plan's launch city: ask Qloo with the
 * location filter, once per entity and city. A refused call (budget or time)
 * is recorded in `refused`; any other failure (Qloo answers 400 when it finds
 * no locality for the city) is remembered per venue, so those venues come back
 * unscored with the reason instead of failing the run, and aren't re-asked.
 */
async function checkInCity(ctx: Ctx, resolved: readonly Resolved[], refused: Map<string, string>) {
  const city = ctx.city;
  if (!city) return;
  const ids = [...new Set(resolved.flatMap((r) => (ROLE_SPEC[r.role].inCity && r.entityId && !ctx.inCity.has(inCityKey(city, r.entityId)) ? [r.entityId] : [])))];
  if (!ids.length) return;
  try {
    const res = await ctx.qloo.insights("urn:entity:place", { ...signalFor(ctx), "filter.location.query": city, "filter.results.entities": ids, take: ids.length });
    const found = new Set((res.data.results.entities ?? []).map((e) => e.entity_id));
    for (const id of ids) ctx.inCity.set(inCityKey(city, id), { ok: found.has(id), key: res.meta.key });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    for (const id of ids) {
      if (isQlooStop(err)) refused.set(id, msg);
      else ctx.inCity.set(inCityKey(city, id), { error: msg });
    }
  }
}

function receiptFor(ctx: Ctx, r: Resolved, refused: Refused): Receipt {
  let out = judge(ctx, r);
  const id = r.entityId;
  const scoreCut = id === undefined ? undefined : refused.score.get(id);
  const venueCut = id === undefined ? undefined : refused.venue.get(id);
  const trendCut = id === undefined ? undefined : refused.trend.get(id);
  // Its own scoring call was refused: say so, rather than "Qloo returned no affinity".
  if (scoreCut && out.verdict === "unscored") out = { ...out, note: `Not checked: ${scoreCut}.` };
  // A pass needs the in-city check that was refused; a miss on affinity stands without it.
  if (venueCut && (out.verdict === "pass" || out.verdict === "fading")) out = { ...out, verdict: "unscored", note: `Not checked: Qloo couldn't confirm it's in ${ctx.city ?? "the launch city"} (${venueCut}).` };
  if (trendCut && out.verdict === "pass") out = { ...out, note: `${out.note} Whether it is fading wasn't checked: ${trendCut}.` };
  if (out.explainabilityWarning) out = { ...out, note: `${out.note} Qloo returned no driver split for this score ("${out.explainabilityWarning}").` };
  return r.matchedAs ? { ...out, note: `${out.note} Matched to Qloo's "${r.matchedAs}".` } : out;
}

function judge(ctx: Ctx, r: Resolved): Receipt {
  const spec = ROLE_SPEC[r.role];
  const base = { name: r.name, type: r.type, role: r.role, entityId: r.entityId, drivers: [] as Receipt["drivers"], calls: r.calls, source: r.source };
  // A brief that fixes the market only needs the plan to agree with it.
  if (r.role === "city" && ctx.audience.targetCity) {
    const ok = sameName(r.name, ctx.audience.targetCity);
    return { ...base, verdict: ok ? "pass" : "miss", note: ok ? "The brief's target market." : `The brief fixes the market to ${ctx.audience.targetCity}.` };
  }
  if (!r.entityId) {
    return r.filedAs
      ? { ...base, verdict: "miss", note: `Qloo files "${r.name}" as ${r.filedAs.replace(/_/g, " ")}, not as a ${spec.types.map((t) => t.replace(/_/g, " ")).join(" or ")}; it can't fill this role.` }
      : { ...base, verdict: "hallucination", note: `Not found in Qloo: no entity matches "${r.name}" in a typed or an untyped search, so it is outside Qloo's catalogue and may be invented.` };
  }

  const pooled = spec.scoreFromPool ? (ctx.candidates[r.role] ?? []).find((c) => c.entityId === r.entityId) : undefined;
  const scored = spec.scoreFromPool ? undefined : ctx.scores.get(r.entityId);
  const affinity = pooled?.affinity ?? scored?.affinity;
  const threshold = thresholdFor(ctx, r.role);
  const trend = ctx.trends.get(r.entityId);
  const venueCheck = spec.inCity && ctx.city ? ctx.inCity.get(inCityKey(ctx.city, r.entityId)) : undefined;
  const venue = venueCheck && "ok" in venueCheck ? venueCheck : undefined;
  const venueError = venueCheck && "error" in venueCheck ? venueCheck.error : undefined;
  const calls = [...r.calls, ...[pooled?.key, scored?.key, venue?.key].filter((k): k is string => !!k)];
  // No score means no number: affinity stays undefined rather than a made-up 0.
  const pool = ctx.candidates[r.role] ?? [];
  const poolRank = affinity !== undefined && pool.length ? { above: pool.filter((c) => c.entityId !== r.entityId && c.affinity > affinity).length, of: pool.filter((c) => c.entityId !== r.entityId).length } : undefined;
  const poolMedian = spec.bar === "median" && pool.length ? r3(median(pool.map((c) => c.affinity))) : undefined;
  const warning = scored?.explainabilityWarning;
  const scoredBase = { ...base, affinity, threshold, poolMedian, poolRank, trend, drivers: scored?.drivers ?? [], calls, source: scored?.source ?? r.source, ...(warning ? { explainabilityWarning: warning } : {}) };

  // Outside the plan's city, a venue misses whatever it scores. With no venues there either, nothing can
  // replace it, so the note says so rather than leaving the reader to wonder why it was kept.
  if (venue && !venue.ok) {
    const city = ctx.city ?? "the launch city";
    const who = ctx.sim.on ? "the offline simulator" : "Qloo";
    const filter = `${who === "Qloo" ? "Qloo's" : "the offline simulator's"} location filter doesn't return it there`;
    const note = pool.length ? `Not in ${city}: ${filter}.` : `Not in ${city} (${filter}), and ${who} returned no venues there to replace it.`;
    return { ...scoredBase, verdict: "miss", outOfCity: city, note };
  }

  if (affinity === undefined && spec.scoreFromPool && threshold !== undefined) {
    return { ...scoredBase, verdict: "miss", note: "Not among the candidates Qloo ranked for this audience." };
  }
  const omittedBy = spec.scoreFromPool ? undefined : ctx.omitted.get(r.entityId);
  if (affinity === undefined && omittedBy !== undefined) {
    // Asked about by id (filter.results.entities) and left out: Qloo doesn't rank it for this audience.
    return { ...scoredBase, calls: [...calls, omittedBy], verdict: "miss", note: "Qloo left it out when asked to score it for this audience (filter.results.entities), so it doesn't rank for them." };
  }
  if (affinity === undefined) return { ...scoredBase, verdict: "unscored", note: "Qloo returned no affinity for it with this audience, so it can't be judged." };
  if (venueError !== undefined) return { ...scoredBase, verdict: "unscored", note: `Qloo couldn't check that it's in ${ctx.city ?? "the launch city"} (the location filter failed: ${venueError}), so it can't be judged.` };
  if (threshold === undefined) return { ...scoredBase, verdict: "unscored", note: `Affinity ${affinity.toFixed(2)}, but Qloo returned no candidates for this role to set a bar from.` };
  if (affinity < threshold) return { ...scoredBase, verdict: "miss", note: `Affinity ${affinity.toFixed(2)} is below the ${threshold.toFixed(2)} bar for this audience.` };
  if (spec.checkFading && trend !== undefined && isFading(ctx, r.entityId)) {
    return { ...scoredBase, verdict: "fading", note: `Fits the audience (${affinity.toFixed(2)}) but its trend is falling (${trend.toFixed(2)}); a hook on it will age badly.` };
  }
  return { ...scoredBase, verdict: "pass", note: `Affinity ${affinity.toFixed(2)} clears the ${threshold.toFixed(2)} bar for this audience.` };
}

/**
 * Resolves, scores and judges every pick. When the run's Qloo budget or time
 * runs out mid-pass, the critic degrades per pick: everything the run already
 * resolved and scored is still judged, and only the picks whose own calls
 * were refused come back "unscored" with the reason (`cut` says why). Any
 * other failure of a required call still throws.
 */
export async function critique(ctx: Ctx, picks: readonly PlanPick[]): Promise<Critique> {
  const unique = uniquePicks(picks);
  const settled = await Promise.allSettled(unique.map((p) => resolvePick(ctx, p)));
  const resolveCut = new Map<number, string>();
  const resolved: (Resolved | undefined)[] = settled.map((s, i) => {
    if (s.status === "fulfilled") return s.value;
    if (!isQlooStop(s.reason)) throw s.reason;
    resolveCut.set(i, s.reason.message);
    return undefined;
  });
  const found = resolved.filter((r): r is Resolved => r !== undefined);
  const refused: Refused = { score: new Map(), venue: new Map(), trend: new Map() };
  const [, , trends] = await Promise.all([
    scoreNew(ctx, found, refused.score),
    checkInCity(ctx, found, refused.venue),
    // Only roles where fading changes the verdict; references already read from the pool cost nothing.
    readTrends(
      ctx,
      found.flatMap((r) => (r.entityId ? [{ entityId: r.entityId, type: r.type, role: r.role }] : [])),
    ),
  ]);
  refused.trend = trends.refused;
  const receipts = unique.map((p, i): Receipt => {
    const r = resolved[i];
    return r ? receiptFor(ctx, r, refused) : { name: p.name, type: p.type, role: p.role, verdict: "unscored", drivers: [], calls: [], note: `Not checked: ${resolveCut.get(i) ?? "Qloo call refused"}.` };
  });
  const cuts = [...new Set([...resolveCut.values(), ...refused.score.values(), ...refused.venue.values(), ...refused.trend.values()])];
  return { receipts, warnings: trends.failures, ...(cuts.length ? { cut: cuts.join("; ") } : {}) };
}

/**
 * One Qloo-preferred replacement per pick that didn't pass (unscored ones
 * included: a pick Qloo couldn't judge is not a pass, and a ranked candidate
 * above the bar is), except after a pass the run's budget or time cut short
 * (`opts.cut`): then unscored picks stay, since nothing says they're bad and
 * the swap couldn't be checked either. Alternatives must clear the role's bar. A city that
 * misses a fixed market is swapped for that market. `tried` accumulates every
 * (normalised) name already proposed or rejected across rounds, so the loop
 * never offers the same swap twice.
 */
export function chooseReplacements(ctx: Ctx, picks: readonly PlanPick[], receipts: readonly Receipt[], tried: Set<string>, opts: { cut?: boolean } = {}): Replacement[] {
  const used = new Set(picks.map((p) => normName(p.name)));
  const out: Replacement[] = [];
  for (const r of receipts) {
    if (r.verdict === "pass" || (opts.cut && r.verdict === "unscored")) continue;
    const target = r.role === "city" ? ctx.audience.targetCity : undefined;
    if (target) {
      const t = normName(target);
      if (r.verdict !== "miss" || used.has(t) || tried.has(t)) continue;
      tried.add(normName(r.name));
      used.add(t);
      tried.add(t);
      out.push({ from: r.name, to: target, type: "locality", role: "city", reason: `The brief fixes the market to ${target}; ${r.name} isn't it.` });
      continue;
    }
    tried.add(normName(r.name));
    const bar = thresholdFor(ctx, r.role);
    const eligible = (ctx.candidates[r.role] ?? []).filter(
      (c) => (bar === undefined || c.affinity >= bar) && !used.has(normName(c.name)) && !tried.has(normName(c.name)) && !(ROLE_SPEC[r.role].checkFading && isFading(ctx, c.entityId)),
    );
    const alt = eligible[0];
    if (!alt) continue;
    used.add(normName(alt.name));
    tried.add(normName(alt.name));
    // Simulated scores are placeholders: the reason then says what happened in words only.
    const plain = ctx.sim.on;
    const was =
      r.verdict === "hallucination"
        ? plain
          ? "isn't in the simulator's catalog"
          : "isn't a Qloo entity"
        : r.verdict === "fading"
          ? plain || r.trend === undefined
            ? "is fading"
            : `is fading (trend ${r.trend.toFixed(2)})`
          : r.verdict === "unscored"
            ? "couldn't be scored"
            : plain || r.affinity === undefined
              ? "scores below the bar"
              : `scores ${r.affinity.toFixed(2)}`;
    out.push({
      from: r.name,
      to: alt.name,
      type: alt.type,
      role: r.role,
      reason: plain
        ? `Simulated preference: ${alt.name} clears the bar in the offline simulator; ${r.name} ${was}.`
        : `Qloo-preferred: ${alt.name} scores ${alt.affinity.toFixed(2)} for this audience; ${r.name} ${was}.`,
      options: eligible.slice(0, 3).map(({ name, type, affinity }) => ({ name, type, affinity })),
    });
  }
  return out;
}
