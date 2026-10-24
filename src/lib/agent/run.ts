/**
 * The Tastemaker agent loop (an evaluator-optimizer workflow with Qloo as the
 * external critic):
 *
 *   resolve → vibe tags → profile (demographics, taste tags) → culture map →
 *   where to launch (locality ranking + heatmap) → venues → timing (trending)
 *   → positioning (compare) → generate (LLM) → Qloo critic → replace & revise
 *   (≤ maxRounds) → pack with receipts.
 *
 * The same model also drafts with no Qloo context ("Without Qloo"), in
 * parallel; the critic audits that plan without fixing it.
 */
import { qlooFromEnv, type QlooClient } from "../qloo/client";
import { AGE_BUCKETS } from "../qloo/types";
import { llmFromEnv } from "../llm";
import { applyReplacements, type Draft, type Grounding, type LLMProvider } from "../llm/types";
import { Brief, ROLE_SPEC, type BriefInput } from "./brief";
import { rankCities } from "./cities";
import { chooseReplacements, critique, metricsOf } from "./critic";
import { audienceOf, discoveryFromConfig, isFading, loadCulture, loadTrends, loadVenues, makeCtx, resolveByName, resolveSeeds, signalFor, type CriticSettings, type Ctx, type Discovery } from "./context";
import { Tracer } from "./trace";
import { RUN_SCHEMA_VERSION, type PlanSide, type QlooHealth, type Receipt, type RunEvent, type RunResult, type TraceStep } from "./types";
import { newRunId, normName, sameName } from "./util";

const emptyDraft = (): Draft => ({ positioning: "", hooks: [], script: "", captions: [], musicBrief: "", picks: [] });

export interface RunOptions extends Partial<CriticSettings> {
  /** Defaults to QLOO_BIAS_TRENDS / QLOO_DIVERSIFY. */
  discovery?: Discovery;
  qloo?: QlooClient;
  llm?: LLMProvider;
  emit?: (e: RunEvent) => void;
  /** Revise rounds after the first critic pass. */
  maxRounds?: number;
  /** After this long, remaining swaps are applied directly instead of asking the model to rewrite. */
  reviseDeadlineMs?: number;
  now?: () => Date;
  newId?: () => string;
}

export function qlooHealth(steps: readonly TraceStep[]): QlooHealth {
  const calls = steps.flatMap((s) => s.calls);
  const reasons = new Map<string, number>();
  for (const c of calls) if (c.fallbackReason) reasons.set(c.fallbackReason, (reasons.get(c.fallbackReason) ?? 0) + 1);
  const fallbackCalls = [...reasons.values()].reduce((a, b) => a + b, 0);
  return {
    calls: calls.length,
    live: calls.filter((c) => c.source === "live" && !c.cached).length,
    cached: calls.filter((c) => c.source === "live" && c.cached).length,
    replay: calls.filter((c) => c.source === "replay").length,
    simulated: calls.filter((c) => c.source === "simulated").length,
    fallbackCalls,
    fallbacks: [...reasons].map(([reason, count]) => ({ reason, count })),
  };
}

function groundingFor(ctx: Ctx, audience: RunResult["audience"], positioning: RunResult["positioning"]): Grounding {
  const grounding: Grounding = {
    tags: audience.tags.slice(0, 6).map((t) => t.name),
    overIndexAges: audience.age.filter((a) => a.value > 0).map((a) => a.bucket),
    candidates: Object.fromEntries(
      Object.entries(ctx.candidates).map(([role, list]) => [
        role,
        list
          .filter((c) => !(ROLE_SPEC[role as keyof typeof ROLE_SPEC].checkFading && isFading(ctx, c.entityId)))
          .slice(0, role === "city" ? 3 : 6)
          .map(({ name, type, affinity }) => ({ name, type, affinity })),
      ]),
    ),
    positioningTags: positioning.filter((p) => p.delta > 0).slice(0, 3).map((p) => p.name),
  };
  return grounding;
}

const critiqueDetail = (receipts: Receipt[], warnings: string[]) => {
  const m = metricsOf(receipts);
  const base = `${m.picks} picks · ${m.hallucinations} invented · ${m.misses} low-affinity · ${m.fading} fading`;
  return warnings.length ? `${base} · trend check failed: ${warnings.join("; ")}` : base;
};

export async function runTastemaker(input: BriefInput, opts: RunOptions = {}): Promise<RunResult> {
  const brief = Brief.parse(input);
  const tracer = new Tracer(opts.emit);
  const qloo = opts.qloo ?? qlooFromEnv();
  const llm = opts.llm ?? llmFromEnv();
  const maxRounds = opts.maxRounds ?? 2;
  const startedAt = Date.now();
  const reviseDeadlineMs = opts.reviseDeadlineMs ?? 60_000;
  const unobserve = qloo.observe(tracer.onCall);

  // The baseline needs no Qloo data, so it drafts while the grounded path runs. Never rejects.
  const baselineStart = Date.now();
  const baselineP = llm.draft({ brief }).then(
    (draft) => ({ draft, ms: Date.now() - baselineStart }),
    (err: unknown) => ({ err: err instanceof Error ? err : new Error(String(err)), ms: Date.now() - baselineStart }),
  );

  try {
    // ---- resolve & profile -------------------------------------------------
    const seeds = await tracer.step("resolve", "Resolve the taste seed", async (s) => {
      const all = await resolveSeeds(qloo, brief);
      const ok = all.filter((x) => x.entityId);
      s.detail = `${ok.length}/${all.length} seeds resolved: ${ok.map((x) => x.matched ?? x.name).join(", ")}`;
      return all;
    });
    const ctx = makeCtx(audienceOf(brief), qloo, seeds, { ...opts, discovery: opts.discovery ?? discoveryFromConfig() });

    const vibe = brief.vibe;
    if (vibe) {
      await tracer.optional("vibe", "Map the brief's vibe to taste tags (/v2/tags, semantic search)", async (s) => {
        const r = await qloo.tags(vibe, 5);
        const tags = (r.data.results.tags ?? []).slice(0, 3);
        ctx.tagIds = tags.map((t) => t.tag_id ?? t.id).filter((x): x is string => !!x);
        s.detail = tags.length ? `“${vibe}” → ${tags.map((t) => t.name).join(", ")}` : "No matching tags; seeds only";
      });
    }

    const audience: RunResult["audience"] = { age: [], gender: [], tags: [] };
    await tracer.optional("demographics", "Who over-indexes (urn:demographics)", async (s) => {
      const r = await qloo.insights("urn:demographics", { "signal.interests.entities": ctx.seedIds });
      const q = r.data.results.demographics?.[0]?.query;
      audience.age = AGE_BUCKETS.flatMap((bucket) => {
        const value = q?.age?.[bucket];
        return value === undefined ? [] : [{ bucket, value }];
      });
      audience.gender = Object.entries(q?.gender ?? {}).map(([bucket, value]) => ({ bucket, value }));
      const top = [...audience.age].sort((a, b) => b.value - a.value)[0];
      s.detail = top ? `Strongest age over-index: ${top.bucket.replace(/_/g, " ")} (${top.value > 0 ? "+" : ""}${top.value.toFixed(2)})` : "No demographic signal";
    });

    await tracer.optional("tags", "Taste vocabulary (urn:tag)", async (s) => {
      const r = await qloo.insights("urn:tag", { ...signalFor(ctx), take: 10 });
      audience.tags = (r.data.results.tags ?? []).map((t) => ({ name: t.name, affinity: t.query?.affinity ?? 0 }));
      s.detail = audience.tags.slice(0, 5).map((t) => t.name).join(", ") || "No tags returned";
    });

    // ---- culture map ---------------------------------------------------------
    await tracer.step("culture", "Cross-domain culture map (/v2/insights)", async (s) => {
      const lists = await loadCulture(ctx);
      s.detail = lists.map(([t, l]) => `${t}: ${l[0]?.name ?? "—"}`).join(" · ");
    });

    // ---- where to launch -----------------------------------------------------
    let heatmap: RunResult["heatmap"] = [];
    let citiesRankedBy: RunResult["citiesRankedBy"] = "none";
    if (!brief.targetCity && brief.candidateCities.length) {
      await tracer.optional("cities", "Where to launch (urn:entity:locality + urn:heatmap)", async (s) => {
        const r = await rankCities(ctx, brief.candidateCities);
        ctx.candidates.city = r.cities;
        heatmap = r.heatmap;
        citiesRankedBy = r.rankedBy;
        const top = r.cities.slice(0, 3).map((c) => `${c.name} ${c.affinity.toFixed(2)}`).join(" › ");
        s.detail = `${top || "No metro ranking"} · ranked by ${r.rankedBy} · ${r.heatmap.length} heatmap cells${r.heatmapError ? ` (heatmap failed: ${r.heatmapError})` : ""}`;
      });
    }
    ctx.city = brief.targetCity ?? ctx.candidates.city?.[0]?.name;
    if (ctx.city) {
      const city = ctx.city;
      await tracer.optional("venues", `Venues in ${city} (urn:entity:place + filter.location)`, async (s) => {
        await loadVenues(ctx, city);
        s.detail = (ctx.candidates.venue ?? []).slice(0, 3).map((v) => v.name).join(", ") || "No venues returned";
      });
    }

    // ---- timing & positioning ------------------------------------------------
    await tracer.optional("trending", "Rising vs. fading (/v2/trending)", async (s) => {
      const items = Object.values(ctx.candidates).flatMap((list) => list.map((c) => ({ entityId: c.entityId, type: c.type })));
      const failures = await loadTrends(ctx, items);
      if (failures.length && !ctx.trends.size) throw new Error(failures.join("; "));
      const fading = (ctx.candidates.reference ?? []).filter((c) => isFading(ctx, c.entityId));
      s.detail = `${ctx.trends.size} trend readings; fading references: ${fading.map((f) => f.name).join(", ") || "none"}${failures.length ? ` · failed: ${failures.join("; ")}` : ""}`;
    });

    const positioning: RunResult["positioning"] = [];
    if (brief.compareTo) {
      const other = brief.compareTo;
      await tracer.optional("compare", `Positioning vs. ${other} (/v2/analysis/compare)`, async (s) => {
        const { hit } = await resolveByName(qloo, other, { take: 3, acceptTop: true });
        if (!hit) throw new Error(`"${other}" did not resolve`);
        const r = await qloo.compare(ctx.seedIds, [hit.entity_id], 10);
        for (const t of r.data.results.tags ?? []) {
          const a = t.query?.a?.affinity ?? 0;
          const b = t.query?.b?.affinity ?? 0;
          positioning.push({ name: t.name, a, b, delta: t.query?.delta ?? a - b });
        }
        s.detail = positioning.filter((p) => p.delta > 0).slice(0, 3).map((p) => `+${p.name}`).join(", ") || "no gap found";
      });
    }

    // ---- generate → critic → revise -----------------------------------------
    const grounding = groundingFor(ctx, audience, positioning);
    let draft: Draft = await tracer.step(
      "generate",
      "Draft the campaign (LLM, Qloo-grounded)",
      async (s) => {
        const d = await llm.draft({ brief, grounding });
        s.detail = `${d.picks.length} cultural picks, ${d.hooks.length} hooks, ${d.captions.length} captions`;
        return d;
      },
      { model: llm.label },
    );

    /**
     * Venues are judged in the city the plan actually chose. When the model picks
     * another ranked metro (the critic accepts the top 3), reload that city's venues.
     */
    const followPlanCity = async (d: Draft) => {
      if (brief.targetCity) return;
      const named = d.picks.find((p) => p.role === "city")?.name;
      const ranked = named ? ctx.candidates.city?.find((c) => sameName(c.name, named)) : undefined;
      if (!ranked || (ctx.city && sameName(ranked.name, ctx.city))) return;
      const city = ranked.name;
      ctx.city = city;
      await tracer.optional(`venues-${normName(city).replace(/ /g, "-")}`, `Venues in ${city}, the plan's city (urn:entity:place + filter.location)`, async (s) => {
        await loadVenues(ctx, city);
        s.detail = (ctx.candidates.venue ?? []).slice(0, 3).map((v) => v.name).join(", ") || "No venues returned";
      });
    };

    const tried = new Set<string>();
    // What each Qloo-preferred pick replaced, keyed by role + new name (chains keep the first original).
    const originals = new Map<string, Receipt>();
    let receipts: Receipt[] = [];
    let rounds = 0;
    for (let round = 1; round <= maxRounds + 1; round++) {
      const current = draft;
      await followPlanCity(current);
      receipts = await tracer.step(`critic-${round}`, `Qloo critic, pass ${round} (filter.results.entities + explainability)`, async (s) => {
        const c = await critique(ctx, current.picks);
        s.detail = critiqueDetail(c.receipts, c.warnings);
        return c.receipts;
      });
      rounds = round;
      if (round > maxRounds || receipts.every((r) => r.verdict === "pass" || r.verdict === "unscored")) break;
      const replacements = chooseReplacements(ctx, current.picks, receipts, tried);
      if (!replacements.length) break;
      for (const rep of replacements) {
        const old = receipts.find((r) => r.role === rep.role && normName(r.name) === normName(rep.from));
        if (old) originals.set(`${rep.role}:${normName(rep.to)}`, originals.get(`${rep.role}:${normName(rep.from)}`) ?? old);
      }
      draft = await tracer.step(
        `revise-${round}`,
        `Revise with Qloo-preferred picks (round ${round})`,
        async (s) => {
          // Code makes the verified swaps; the model only polishes the copy around them.
          const swapped = applyReplacements(current, replacements);
          let note = "";
          let polished = swapped;
          if (Date.now() - startedAt > reviseDeadlineMs) {
            note = " · time budget reached; copy not re-polished";
          } else {
            try {
              const p = await llm.revise(swapped, replacements, { brief, grounding });
              // The model may not move picks, and may not bring a rejected name back into the copy.
              polished = applyReplacements({ ...p, picks: swapped.picks }, replacements);
            } catch (err) {
              note = ` · LLM polish failed (${(err as Error).message}); swaps applied, copy unpolished`;
            }
          }
          s.detail = replacements.map((r) => `${r.from} → ${r.to}`).join("; ") + note;
          return polished;
        },
        { model: llm.label },
      );
    }
    receipts = receipts.map((r) => {
      const o = originals.get(`${r.role}:${normName(r.name)}`);
      return o ? { ...r, replaced: { name: o.name, verdict: o.verdict, affinity: o.affinity } } : r;
    });

    // ---- without Qloo ----------------------------------------------------------
    const base = await baselineP;
    tracer.record({
      id: "baseline",
      title: "Same model, no Qloo access (baseline, drafted in parallel)",
      status: "err" in base ? "error" : "done",
      detail: "err" in base ? base.err.message : `${base.draft.picks.length} cultural picks`,
      ms: base.ms,
      model: llm.label,
    });
    let baselineReceipts: Receipt[] = [];
    if (!("err" in base)) {
      // The baseline's venues are judged in the baseline's own city, not the grounded plan's.
      const ownCity = brief.targetCity ?? base.draft.picks.find((p) => p.role === "city")?.name ?? ctx.city;
      baselineReceipts = await tracer.step("audit", "Qloo audit of the baseline plan", async (s) => {
        const c = await critique({ ...ctx, city: ownCity }, base.draft.picks);
        s.detail = critiqueDetail(c.receipts, c.warnings);
        return c.receipts;
      });
    }

    const grounded: PlanSide & { rounds: number } = { draft, receipts, rounds };
    // A failed baseline doesn't throw away a finished grounded plan; the comparison is marked unavailable.
    const baseline: PlanSide = "err" in base ? { draft: emptyDraft(), receipts: [], unavailable: base.err.message } : { draft: base.draft, receipts: baselineReceipts };
    const health = qlooHealth(tracer.steps);
    const sources = [...new Set(tracer.steps.flatMap((s) => s.calls.map((c) => c.source)))];
    const result: RunResult = {
      id: (opts.newId ?? newRunId)(),
      version: RUN_SCHEMA_VERSION,
      brief,
      createdAt: (opts.now?.() ?? new Date()).toISOString(),
      durationMs: Date.now() - startedAt,
      llm: { id: llm.id, label: llm.label, scripted: llm.scripted },
      sources,
      qloo: health,
      seeds: seeds.map((s) => ({ name: s.name, entityId: s.entityId, type: s.type })),
      audience,
      cities: (ctx.candidates.city ?? []).map(({ name, entityId, affinity, lat, lon }) => ({ name, entityId, affinity, lat, lon })),
      heatmap,
      citiesRankedBy,
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
    unobserve();
  }
}
