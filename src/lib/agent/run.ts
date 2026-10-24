/**
 * The Tastemaker agent loop.
 *
 *   resolve → profile (demographics, taste tags) → culture map (cross-domain
 *   insights) → where to launch (locality ranking + heatmap) → timing
 *   (trending) → positioning (analysis/compare) → generate (LLM) →
 *   Qloo critic (filter.results.entities + explainability) → replace & revise
 *   → pack with receipts.
 *
 * The same model also drafts a plan with no Qloo context ("Without Qloo"),
 * and the critic audits that plan without fixing it, so the UI can show what
 * Qloo caught.
 */
import { qlooFromEnv, type QlooCallMeta, type QlooClient, type QlooSource } from "../qloo/client";
import type { Entity } from "../qloo/types";
import { AGE_BUCKETS, type EntityType } from "../qloo/types";
import { llmFromEnv } from "../llm";
import type { Candidate, Draft, Grounding, LLMProvider, Replacement } from "../llm/types";
import { Brief, type BriefInput, type PickType, type Role } from "./brief";
import { hashId, median, sameName } from "./util";
import type { CityScore, Metrics, PlanSide, Receipt, RunEvent, RunResult, TraceStep, Verdict } from "./types";

export interface RunOptions {
  qloo?: QlooClient;
  llm?: LLMProvider;
  emit?: (e: RunEvent) => void;
  /** Critic passes / revise rounds. */
  maxRounds?: number;
  /** A pick fails when its affinity is below this fraction of the role's median top-candidate affinity. */
  missRatio?: number;
  /** Absolute affinity floor for a pass, whatever the category's median. */
  minAffinity?: number;
  /** Trend velocity below which a hook reference counts as fading. */
  fadingBelow?: number;
  now?: () => Date;
}

const CULTURE_TYPES = ["artist", "brand", "tv_show", "movie", "podcast", "person"] as const satisfies readonly (EntityType & PickType)[];
const TREND_TYPES: EntityType[] = ["artist", "tv_show", "movie", "podcast"];

/** signal.demographics.age takes coarse buckets; the output buckets are finer. */
export function signalAges(ages: readonly string[]): string[] {
  const out = new Set<string>();
  for (const a of ages) {
    if (a === "24_and_younger" || a === "25_to_29" || a === "30_to_34") out.add("35_and_younger");
    else if (a === "35_to_44" || a === "45_to_54") out.add("36_to_55");
    else if (a === "55_and_older") out.add("55_and_older");
  }
  return [...out];
}

class Tracer {
  readonly steps: TraceStep[] = [];
  private current?: TraceStep;
  constructor(private readonly emit?: (e: RunEvent) => void) {}

  onCall = (m: QlooCallMeta) => {
    this.current?.calls.push(m);
  };

  async step<T>(id: string, title: string, fn: (s: TraceStep) => Promise<T>, opts: { optional?: boolean; model?: string } = {}): Promise<T | undefined> {
    const s: TraceStep = { id, title, detail: "", status: "done", ms: 0, calls: [], model: opts.model };
    this.current = s;
    const t0 = Date.now();
    try {
      return await fn(s);
    } catch (err) {
      s.status = "error";
      s.detail = err instanceof Error ? err.message : String(err);
      if (!opts.optional) throw err;
      return undefined;
    } finally {
      s.ms = Date.now() - t0;
      this.current = undefined;
      this.steps.push(s);
      this.emit?.({ type: "step", step: s });
    }
  }
}

interface Ctx {
  brief: Brief;
  qloo: QlooClient;
  seedIds: string[];
  seedNames: Map<string, string>;
  signal: Record<string, string[] | string | undefined>;
  candidates: Partial<Record<Role, (Candidate & { entityId: string; trend?: number })[]>>;
  cities: CityScore[];
  /** Request key of the locality ranking call. */
  citiesKey?: string;
  trends: Map<string, number>;
  missRatio: number;
  minAffinity: number;
  fadingBelow: number;
  /** Launch city, when known; venues must be in it. */
  city?: string;
}

function toCandidate(e: Entity, type: PickType) {
  return { name: e.name, type, affinity: e.query?.affinity ?? 0, entityId: e.entity_id };
}

function entityTypeOf(e: Entity): string | undefined {
  return (e.subtype ?? e.types?.[0])?.replace("urn:entity:", "");
}

function thresholdFor(ctx: Ctx, role: Role): number {
  if (role === "city") return ctx.cities[Math.min(2, ctx.cities.length - 1)]?.affinity ?? 0.5;
  const affs = (ctx.candidates[role] ?? []).map((c) => c.affinity);
  if (!affs.length) return 0.5;
  return Math.round(Math.max(ctx.minAffinity, ctx.missRatio * median(affs)) * 1000) / 1000;
}

async function critique(ctx: Ctx, draft: Draft): Promise<Receipt[]> {
  const { qloo } = ctx;
  const seen = new Set<string>();
  const picks = draft.picks.filter((p) => {
    const k = `${p.role}:${p.name.toLowerCase()}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  // 1. Resolve every named entity. Unresolvable = the model made it up.
  const resolved = await Promise.all(
    picks.map(async (p) => {
      const known = (ctx.candidates[p.role] ?? []).find((c) => sameName(c.name, p.name));
      if (known) return { p, entityId: known.entityId, type: known.type, calls: [] as string[], source: undefined as QlooSource | undefined };
      if (p.role === "city") {
        const c = ctx.cities.find((c) => sameName(c.name, p.name));
        if (c?.entityId) return { p, entityId: c.entityId, type: "locality" as PickType, calls: [], source: undefined };
      }
      const types = p.role === "reference" ? (["tv_show", "movie"] as EntityType[]) : [p.type as EntityType];
      const r = await qloo.search(p.name, types, 5);
      const hit = r.data.results.find((e) => sameName(e.name, p.name));
      const t = hit ? ((entityTypeOf(hit) as PickType | undefined) ?? p.type) : p.type;
      return { p, entityId: hit?.entity_id, type: t, calls: [r.meta.key], source: r.meta.source };
    }),
  );

  // 2. Score resolved picks against the audience, grouped by type.
  const scores = new Map<string, { affinity: number; drivers: { name: string; score: number }[]; key: string; source: QlooSource }>();
  const byType = new Map<string, string[]>();
  for (const r of resolved) {
    if (!r.entityId || r.type === "locality") continue;
    byType.set(r.type, [...(byType.get(r.type) ?? []), r.entityId]);
  }
  await Promise.all(
    [...byType].map(async ([type, ids]) => {
      const res = await qloo.insights(`urn:entity:${type as EntityType}`, {
        ...ctx.signal,
        "filter.results.entities": ids,
        "feature.explainability": true,
        take: ids.length,
      });
      for (const e of res.data.results.entities ?? []) {
        const ex = e.query?.explainability?.["signal.interests.entities"] ?? [];
        scores.set(e.entity_id, {
          affinity: e.query?.affinity ?? 0,
          drivers: ex.map((d) => ({ name: d.name ?? ctx.seedNames.get(d.entity_id ?? "") ?? d.entity_id ?? "signal", score: d.score })),
          key: res.meta.key,
          source: res.meta.source,
        });
      }
    }),
  );

  // 2b. Venues must actually be in the launch city: ask Qloo with the location filter.
  const venueIds = resolved.filter((r) => r.p.role === "venue" && r.entityId).map((r) => r.entityId!);
  const inCity = new Set<string>();
  let inCityKey: string | undefined;
  if (ctx.city && venueIds.length) {
    const res = await qloo.insights("urn:entity:place", {
      ...ctx.signal,
      "filter.location.query": ctx.city,
      "filter.results.entities": venueIds,
      take: venueIds.length,
    });
    inCityKey = res.meta.key;
    for (const e of res.data.results.entities ?? []) inCity.add(e.entity_id);
  }

  // 3. Timing for anything we don't already have a trend for.
  const needTrend = new Map<EntityType, string[]>();
  for (const r of resolved) {
    if (!r.entityId || ctx.trends.has(r.entityId) || !TREND_TYPES.includes(r.type as EntityType)) continue;
    needTrend.set(r.type as EntityType, [...(needTrend.get(r.type as EntityType) ?? []), r.entityId]);
  }
  await Promise.all(
    [...needTrend].map(async ([type, ids]) => {
      try {
        const res = await qloo.trending(type, ids);
        for (const e of res.data.results.entities ?? []) {
          const v = e.query?.population_rank_velocity;
          if (typeof v === "number") ctx.trends.set(e.entity_id, v);
        }
      } catch {
        // timing is advisory; never fail the critic on it
      }
    }),
  );

  // 4. Verdicts.
  return resolved.map(({ p, entityId, type, calls, source }) => {
    const base = { name: p.name, type, role: p.role, entityId, drivers: [], calls: [...calls] } as Omit<Receipt, "verdict" | "note">;
    if (!entityId) {
      return { ...base, verdict: "hallucination", source, note: `No Qloo entity matches "${p.name}" — the model likely invented it.` } satisfies Receipt;
    }
    const threshold = thresholdFor(ctx, p.role);
    if (p.role === "city") {
      const c = ctx.cities.find((c) => c.entityId === entityId);
      const affinity = c?.affinity ?? 0;
      const verdict: Verdict = affinity >= threshold ? "pass" : "miss";
      return {
        ...base,
        calls: [...base.calls, ...(ctx.citiesKey ? [ctx.citiesKey] : [])],
        affinity,
        threshold,
        verdict,
        note: verdict === "pass" ? `Top-3 metro for this audience (affinity ${affinity.toFixed(2)}).` : `Outside the top 3 metros for this audience (affinity ${affinity.toFixed(2)} vs ${threshold.toFixed(2)}).`,
      } satisfies Receipt;
    }
    const s = scores.get(entityId);
    const affinity = s?.affinity ?? 0;
    const trend = ctx.trends.get(entityId);
    let verdict: Verdict = affinity >= threshold ? "pass" : "miss";
    if (verdict === "pass" && p.role === "reference" && trend !== undefined && trend < ctx.fadingBelow) verdict = "fading";
    const wrongCity = p.role === "venue" && !!ctx.city && inCityKey !== undefined && !inCity.has(entityId);
    if (wrongCity) verdict = "miss";
    const note = wrongCity
      ? `Not in ${ctx.city}: Qloo's location filter doesn't return it there.`
      : verdict === "pass"
        ? `Affinity ${affinity.toFixed(2)} clears the ${threshold.toFixed(2)} bar for this audience.`
        : verdict === "fading"
          ? `Fits the audience (${affinity.toFixed(2)}) but its trend is falling (${trend!.toFixed(2)}); a hook on it will age badly.`
          : `Affinity ${affinity.toFixed(2)} is below the ${threshold.toFixed(2)} bar for this audience.`;
    return {
      ...base,
      affinity,
      threshold,
      trend,
      drivers: s?.drivers ?? [],
      calls: [...calls, ...(s ? [s.key] : []), ...(p.role === "venue" && inCityKey ? [inCityKey] : [])],
      source: s?.source ?? source,
      verdict,
      note,
    } satisfies Receipt;
  });
}

function metricsOf(receipts: Receipt[]): Metrics {
  const picks = receipts.length;
  const hallucinations = receipts.filter((r) => r.verdict === "hallucination").length;
  const misses = receipts.filter((r) => r.verdict === "miss").length;
  const fading = receipts.filter((r) => r.verdict === "fading").length;
  return { picks, hallucinations, misses, fading, cultureMissRate: picks ? Math.round(((hallucinations + misses) / picks) * 1000) / 1000 : 0 };
}

function chooseReplacements(ctx: Ctx, draft: Draft, receipts: Receipt[], rejected: Set<string>): Replacement[] {
  const used = new Set(draft.picks.map((p) => p.name.toLowerCase()));
  const out: Replacement[] = [];
  for (const r of receipts) {
    if (r.verdict === "pass") continue;
    rejected.add(r.name.toLowerCase());
    const pool =
      r.role === "city"
        ? ctx.cities.map((c) => ({ name: c.name, type: "locality" as PickType, affinity: c.affinity, entityId: c.entityId, trend: undefined }))
        : (ctx.candidates[r.role] ?? []);
    const alt = pool.find(
      (c) =>
        !used.has(c.name.toLowerCase()) &&
        !rejected.has(c.name.toLowerCase()) &&
        !(r.role === "reference" && (ctx.trends.get(c.entityId ?? "") ?? 0) < ctx.fadingBelow),
    );
    if (!alt) continue;
    used.add(alt.name.toLowerCase());
    const was = r.verdict === "hallucination" ? "isn't a Qloo entity" : r.verdict === "fading" ? `is fading (trend ${r.trend?.toFixed(2)})` : `scores ${r.affinity?.toFixed(2)}`;
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

export async function runTastemaker(input: BriefInput, opts: RunOptions = {}): Promise<RunResult> {
  const brief = Brief.parse(input);
  const tracer = new Tracer(opts.emit);
  const qloo = opts.qloo ?? qlooFromEnv();
  const llm = opts.llm ?? llmFromEnv();
  const prevOnCall = qloo.onCall;
  qloo.onCall = (m) => {
    tracer.onCall(m);
    prevOnCall?.(m);
  };
  const missRatio = opts.missRatio ?? 0.7;
  const fadingBelow = opts.fadingBelow ?? -0.3;
  const maxRounds = opts.maxRounds ?? 2;

  try {
    // ---- 1. Resolve seeds ---------------------------------------------------
    const seeds = (await tracer.step("resolve", "Resolve the taste seed", async (s) => {
      const fromLinks = await resolveLinks(qloo, brief.seedLinks);
      const named = await Promise.all(
        brief.seeds.map(async (name) => {
          const r = await qloo.search(name, undefined, 5);
          const hit = r.data.results.find((e) => sameName(e.name, name)) ?? r.data.results[0];
          return { name, entityId: hit?.entity_id, type: hit ? entityTypeOf(hit) : undefined, matched: hit?.name };
        }),
      );
      const all = [...fromLinks, ...named];
      const ok = all.filter((x) => x.entityId);
      s.detail = `${ok.length}/${all.length} seeds resolved: ${ok.map((x) => x.matched ?? x.name).join(", ")}`;
      if (!ok.length) throw new Error("None of the seeds resolved to a Qloo entity; try different names.");
      return all;
    }))!;
    const seedIds = [...new Set(seeds.filter((s) => s.entityId).map((s) => s.entityId!))];
    const seedNames = new Map(seeds.filter((s) => s.entityId).map((s) => [s.entityId!, s.name]));
    const signal = {
      "signal.interests.entities": seedIds,
      "signal.demographics.age": signalAges(brief.ages),
      "signal.demographics.gender": brief.gender,
    };
    const ctx: Ctx = { brief, qloo, seedIds, seedNames, signal, candidates: {}, cities: [], trends: new Map(), missRatio, minAffinity: opts.minAffinity ?? 0.25, fadingBelow };

    // ---- 2. Profile the audience -------------------------------------------
    const audience: RunResult["audience"] = { age: [], gender: [], tags: [] };
    await tracer.step("demographics", "Who over-indexes (urn:demographics)", async (s) => {
      const r = await qloo.insights("urn:demographics", { "signal.interests.entities": seedIds });
      const q = r.data.results.demographics?.[0]?.query;
      audience.age = AGE_BUCKETS.filter((b) => q?.age?.[b] !== undefined).map((b) => ({ bucket: b, value: q!.age![b] }));
      audience.gender = Object.entries(q?.gender ?? {}).map(([bucket, value]) => ({ bucket, value }));
      const top = [...audience.age].sort((a, b) => b.value - a.value)[0];
      s.detail = top ? `Strongest age over-index: ${top.bucket.replace(/_/g, " ")} (${top.value > 0 ? "+" : ""}${top.value.toFixed(2)})` : "No demographic signal";
    }, { optional: true });

    await tracer.step("tags", "Taste vocabulary (urn:tag)", async (s) => {
      const r = await qloo.insights("urn:tag", { ...signal, take: 10 });
      audience.tags = (r.data.results.tags ?? []).map((t) => ({ name: t.name, affinity: t.query?.affinity ?? 0 }));
      s.detail = audience.tags.slice(0, 5).map((t) => t.name).join(", ");
    }, { optional: true });

    // ---- 3. Cross-domain culture map ---------------------------------------
    await tracer.step("culture", "Cross-domain culture map (/v2/insights)", async (s) => {
      const lists = await Promise.all(
        CULTURE_TYPES.map(async (t) => {
          const r = await qloo.insights(`urn:entity:${t}`, { ...signal, take: 10 });
          return [t, (r.data.results.entities ?? []).map((e) => toCandidate(e, t))] as const;
        }),
      );
      const by = Object.fromEntries(lists) as Record<(typeof CULTURE_TYPES)[number], ReturnType<typeof toCandidate>[]>;
      ctx.candidates.collab = by.artist;
      ctx.candidates.sponsor = by.brand;
      ctx.candidates.podcast = by.podcast;
      ctx.candidates.presenter = by.person;
      ctx.candidates.reference = [...by.tv_show, ...by.movie].sort((a, b) => b.affinity - a.affinity);
      s.detail = lists.map(([t, l]) => `${t}: ${l[0]?.name ?? "—"}`).join(" · ");
    });

    // ---- 4. Where to launch -------------------------------------------------
    let city = brief.targetCity;
    const heatmap: RunResult["heatmap"] = [];
    if (!brief.targetCity && brief.candidateCities.length) {
      await tracer.step("cities", "Rank candidate metros (urn:entity:locality)", async (s) => {
        const resolved = await Promise.all(
          brief.candidateCities.map(async (c) => {
            const r = await qloo.search(c, ["locality"], 3);
            const hit = r.data.results.find((e) => sameName(e.name, c)) ?? r.data.results[0];
            return hit ? { name: c, entity: hit } : undefined;
          }),
        );
        const ok = resolved.filter((x): x is { name: string; entity: Entity } => !!x);
        const r = await qloo.insights("urn:entity:locality", {
          ...signal,
          "filter.results.entities": ok.map((x) => x.entity.entity_id),
          take: ok.length,
        });
        ctx.cities = (r.data.results.entities ?? [])
          .map((e) => {
            const src = ok.find((x) => x.entity.entity_id === e.entity_id);
            return { name: src?.name ?? e.name, entityId: e.entity_id, affinity: e.query?.affinity ?? 0, lat: e.location?.lat, lon: e.location?.lon };
          })
          .sort((a, b) => b.affinity - a.affinity);
        ctx.citiesKey = r.meta.key;
        city = ctx.cities[0]?.name;
        s.detail = ctx.cities.slice(0, 3).map((c) => `${c.name} ${c.affinity.toFixed(2)}`).join(" › ");
      }, { optional: true });

      await tracer.step("heatmap", "Demand heatmap (urn:heatmap, locality boundary)", async (s) => {
        const r = await qloo.insights("urn:heatmap", {
          "signal.interests.entities": seedIds,
          "signal.demographics.age": signal["signal.demographics.age"],
          "output.heatmap.boundary": "urn:entity:locality",
          take: 50,
        });
        for (const c of r.data.results.heatmap ?? []) {
          heatmap.push({ name: c.location.name, lat: c.location.latitude, lon: c.location.longitude, affinity: c.query.affinity ?? c.query.affinity_rank ?? 0 });
        }
        s.detail = `${heatmap.length} cells`;
      }, { optional: true });
    }
    ctx.city = city;
    if (city) {
      await tracer.step("venues", `Venues in ${city} (urn:entity:place + filter.location)`, async (s) => {
        const r = await qloo.insights("urn:entity:place", { ...signal, "filter.location.query": city, take: 10 });
        ctx.candidates.venue = (r.data.results.entities ?? []).map((e) => toCandidate(e, "place"));
        s.detail = ctx.candidates.venue.slice(0, 3).map((v) => v.name).join(", ") || "No venues returned";
      }, { optional: true });
    }

    // ---- 5. Timing -----------------------------------------------------------
    await tracer.step("trending", "Rising vs. fading (/v2/trending)", async (s) => {
      const groups = new Map<EntityType, string[]>();
      for (const [role, list] of Object.entries(ctx.candidates)) {
        for (const c of list ?? []) {
          const t = c.type as EntityType;
          if (!TREND_TYPES.includes(t) || role === "venue") continue;
          groups.set(t, [...(groups.get(t) ?? []), c.entityId]);
        }
      }
      await Promise.all(
        [...groups].map(async ([t, ids]) => {
          const r = await qloo.trending(t, ids);
          for (const e of r.data.results.entities ?? []) {
            const v = e.query?.population_rank_velocity;
            if (typeof v === "number") ctx.trends.set(e.entity_id, v);
          }
        }),
      );
      const fading = [...(ctx.candidates.reference ?? [])].filter((c) => (ctx.trends.get(c.entityId) ?? 0) < fadingBelow);
      s.detail = `${ctx.trends.size} trend readings; fading references: ${fading.map((f) => f.name).join(", ") || "none"}`;
    }, { optional: true });

    // ---- 6. Positioning -----------------------------------------------------
    const positioning: RunResult["positioning"] = [];
    if (brief.compareTo) {
      await tracer.step("compare", `Positioning vs. ${brief.compareTo} (/v2/analysis/compare)`, async (s) => {
        const r0 = await qloo.search(brief.compareTo!, undefined, 3);
        const other = r0.data.results.find((e) => sameName(e.name, brief.compareTo!)) ?? r0.data.results[0];
        if (!other) throw new Error(`"${brief.compareTo}" did not resolve`);
        const r = await qloo.compare(seedIds, [other.entity_id], 10);
        for (const t of r.data.results.tags ?? []) {
          const a = t.query?.a?.affinity ?? 0;
          const b = t.query?.b?.affinity ?? 0;
          positioning.push({ name: t.name, a, b, delta: t.query?.delta ?? a - b });
        }
        s.detail = positioning.filter((p) => p.delta > 0).slice(0, 3).map((p) => `+${p.name}`).join(", ") || "no gap found";
      }, { optional: true });
    }

    const grounding: Grounding = {
      tags: audience.tags.slice(0, 6).map((t) => t.name),
      overIndexAges: audience.age.filter((a) => a.value > 0).map((a) => a.bucket),
      candidates: Object.fromEntries(
        Object.entries(ctx.candidates).map(([role, list]) => [
          role,
          (list ?? [])
            .filter((c) => !(role === "reference" && (ctx.trends.get(c.entityId) ?? 0) < fadingBelow))
            .slice(0, 6)
            .map(({ name, type, affinity }) => ({ name, type, affinity })),
        ]),
      ),
      positioningTags: positioning.filter((p) => p.delta > 0).slice(0, 3).map((p) => p.name),
    };
    if (ctx.cities.length) grounding.candidates.city = ctx.cities.slice(0, 3).map((c) => ({ name: c.name, type: "locality", affinity: c.affinity }));

    // ---- 7. Generate (grounded) --------------------------------------------
    let draft = (await tracer.step("generate", "Draft the campaign (LLM, Qloo-grounded)", async (s) => {
      const d = await llm.draft({ brief, grounding });
      s.detail = `${d.picks.length} cultural picks, ${d.hooks.length} hooks, ${d.captions.length} captions`;
      return d;
    }, { model: llm.label }))!;

    // ---- 8. Critic loop -----------------------------------------------------
    const rejected = new Set<string>();
    const originals = new Map<string, Receipt>();
    let receipts: Receipt[] = [];
    let rounds = 0;
    for (let round = 1; round <= maxRounds + 1; round++) {
      receipts = (await tracer.step(`critic-${round}`, `Qloo critic, pass ${round} (filter.results.entities + explainability)`, async (s) => {
        const r = await critique(ctx, draft);
        const m = metricsOf(r);
        s.detail = `${m.picks} picks · ${m.hallucinations} invented · ${m.misses} low-affinity · ${m.fading} fading`;
        return r;
      }))!;
      rounds = round;
      if (round > maxRounds || receipts.every((r) => r.verdict === "pass")) break;
      const replacements = chooseReplacements(ctx, draft, receipts, rejected);
      if (!replacements.length) break;
      for (const rep of replacements) {
        const old = receipts.find((r) => r.name === rep.from && r.role === rep.role);
        const chainKey = `${rep.role}:${rep.from}`;
        if (old) originals.set(`${rep.role}:${rep.to}`, originals.get(chainKey) ?? old);
      }
      const current = draft;
      draft = (await tracer.step(`revise-${round}`, `Revise with Qloo-preferred picks (round ${round})`, async (s) => {
        const d = await llm.revise(current, replacements, { brief, grounding });
        s.detail = replacements.map((r) => `${r.from} → ${r.to}`).join("; ");
        return d;
      }, { model: llm.label }))!;
    }
    receipts = receipts.map((r) => {
      const o = originals.get(`${r.role}:${r.name}`);
      return o ? { ...r, replaced: { name: o.name, verdict: o.verdict, affinity: o.affinity } } : r;
    });

    // ---- 9. Without Qloo ----------------------------------------------------
    const baselineDraft = (await tracer.step("baseline", "Same model, no Qloo access (baseline)", async (s) => {
      const d = await llm.draft({ brief });
      s.detail = `${d.picks.length} cultural picks`;
      return d;
    }, { model: llm.label }))!;
    const baselineReceipts = (await tracer.step("audit", "Qloo audit of the baseline plan", async (s) => {
      const r = await critique(ctx, baselineDraft);
      const m = metricsOf(r);
      s.detail = `${m.hallucinations} invented · ${m.misses} low-affinity · ${m.fading} fading of ${m.picks}`;
      return r;
    }))!;

    const grounded: PlanSide & { rounds: number } = { draft, receipts, rounds };
    const baseline: PlanSide = { draft: baselineDraft, receipts: baselineReceipts };
    const sources = [...new Set(tracer.steps.flatMap((s) => s.calls.map((c) => c.source)))];
    const result: RunResult = {
      id: hashId(JSON.stringify([brief, llm.id, sources])),
      version: 1,
      brief,
      createdAt: (opts.now?.() ?? new Date()).toISOString(),
      llm: { id: llm.id, label: llm.label, scripted: llm.scripted },
      sources,
      seeds: seeds.map((s) => ({ name: s.name, entityId: s.entityId, type: s.type })),
      audience,
      cities: ctx.cities,
      heatmap,
      positioning,
      compareTo: brief.compareTo,
      grounded,
      baseline,
      metrics: { grounded: metricsOf(receipts), baseline: metricsOf(baselineReceipts) },
      trace: tracer.steps,
    };
    opts.emit?.({ type: "result", result });
    return result;
  } finally {
    qloo.onCall = prevOnCall;
  }
}

/** Seed from pasted Spotify / IMDb links via /entities external-ID lookup. */
async function resolveLinks(qloo: QlooClient, links: string[]) {
  const spotify: string[] = [];
  const imdb: string[] = [];
  for (const l of links) {
    const sp = l.match(/open\.spotify\.com\/(?:intl-[a-z]+\/)?artist\/([A-Za-z0-9]{10,30})/);
    if (sp) spotify.push(sp[1]);
    const im = l.match(/imdb\.com\/(?:title|name)\/((?:tt|nm)\d{5,10})/);
    if (im) imdb.push(im[1]);
  }
  const out: { name: string; entityId?: string; type?: string; matched?: string }[] = [];
  for (const [kind, ids] of [["spotify", spotify], ["imdb", imdb]] as const) {
    if (!ids.length) continue;
    const r = await qloo.entitiesByExternal(kind, ids);
    for (const e of r.data.results) out.push({ name: e.name, entityId: e.entity_id, type: entityTypeOf(e), matched: e.name });
    if (!r.data.results.length) out.push(...ids.map((id) => ({ name: `${kind}:${id}` })));
  }
  return out;
}
