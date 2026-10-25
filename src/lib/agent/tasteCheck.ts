/** The critic on its own: score arbitrary picks against an audience (used by MCP). */
import { isQlooStop } from "../qloo/errors";
import { sameName } from "./util";
import { qlooFromEnv, type QlooClient, type QlooSource } from "../qloo/client";
import type { Pick as PlanPick, Replacement } from "../llm/types";
import type { Brief } from "./brief";
import { chooseReplacements, critique, metricsOf } from "./critic";
import { rankCities } from "./cities";
import { PRESETS } from "./presets";
import { discoveryFromConfig, loadCulture, loadVenues, makeCtx, resolveSeeds, watchSimulated, type Audience, type CriticSettings } from "./context";
import type { Metrics, Receipt } from "./types";

export interface TasteCheckInput {
  /** Names the audience already loves. */
  seeds: Brief["seeds"];
  ages: Audience["ages"];
  gender?: Audience["gender"];
  /** Launch city: a city pick must match it, and venues must be in it. */
  city?: string;
  picks: Omit<PlanPick, "rationale">[];
}

export interface TasteCheckResult {
  receipts: Receipt[];
  metrics: Metrics;
  /** Qloo-preferred alternative per failing pick, when one exists. */
  suggestions: Replacement[];
  sources: QlooSource[];
  warnings: string[];
}

export async function tasteCheck(input: TasteCheckInput, opts: Partial<CriticSettings> & { qloo?: QlooClient } = {}): Promise<TasteCheckResult> {
  const qloo = opts.qloo ?? qlooFromEnv();
  const sources = new Set<QlooSource>();
  const unobserve = qloo.observe((m) => sources.add(m.source));
  // Replacement reasons name no placeholder score once an answer is simulated.
  const watch = watchSimulated(qloo);
  try {
    const audience: Audience = { ages: input.ages, gender: input.gender, targetCity: input.city };
    const ctx = makeCtx(audience, qloo, await resolveSeeds(qloo, { seeds: input.seeds, seedLinks: [] }), { ...opts, discovery: discoveryFromConfig(), sim: watch.sim });
    const picks: PlanPick[] = input.picks.map((p) => ({ ...p, rationale: "" }));
    const cityWarnings: string[] = [];
    // Only the candidate pools these picks need (thresholds and replacements come from them).
    await loadCulture(ctx, [...new Set(picks.map((p) => p.role))]);
    if (input.city) {
      ctx.city = input.city;
      if (picks.some((p) => p.role === "venue")) {
        // Qloo answers 400 when it can't place the city: the venues go unchecked (and say why) instead of failing the check.
        await loadVenues(ctx, input.city).catch((err: unknown) => {
          if (isQlooStop(err)) throw err;
          ctx.candidates.venue = [];
          cityWarnings.push(`couldn't load venues in ${input.city ?? ""} (${err instanceof Error ? err.message : String(err)})`);
        });
      }
    } else {
      // No fixed market: rank the named cities alongside the default US metros, so a city pick is judged by rank.
      const named = picks.filter((p) => p.role === "city").map((p) => p.name);
      if (named.length) {
        const pool = [...new Set([...named, ...(PRESETS[0].brief.candidateCities ?? [])])].slice(0, 16);
        // The plan's own city names count only on an exact Qloo match, so an invented city can't borrow a real one's rank.
        ctx.candidates.city = (await rankCities(ctx, pool, { exact: named })).cities;
        // Venues are judged in the city the plan names, once Qloo knows it by that name (as the agent judges its own plan's venues).
        const planCity = named.find((n) => ctx.candidates.city?.some((c) => sameName(c.name, n)));
        if (planCity && picks.some((p) => p.role === "venue")) {
          ctx.city = planCity;
          await loadVenues(ctx, planCity);
        }
      }
    }
    const { receipts, warnings, cut } = await critique(ctx, picks);
    return {
      receipts,
      metrics: metricsOf(receipts),
      suggestions: chooseReplacements(ctx, picks, receipts, new Set(), { cut: cut !== undefined }),
      sources: [...sources],
      warnings: [...cityWarnings, ...warnings, ...(cut ? [`cut short: ${cut}`] : [])],
    };
  } finally {
    unobserve();
    watch.stop();
  }
}
