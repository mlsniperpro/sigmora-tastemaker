/** The critic on its own: score arbitrary picks against an audience (used by MCP). */
import { qlooFromEnv, type QlooClient, type QlooSource } from "../qloo/client";
import type { Pick as PlanPick, Replacement } from "../llm/types";
import type { Brief } from "./brief";
import { chooseReplacements, critique, metricsOf } from "./critic";
import { rankCities } from "./cities";
import { PRESETS } from "./presets";
import { discoveryFromConfig, loadCulture, loadVenues, makeCtx, resolveSeeds, type Audience, type CriticSettings } from "./context";
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
  try {
    const audience: Audience = { ages: input.ages, gender: input.gender, targetCity: input.city };
    const ctx = makeCtx(audience, qloo, await resolveSeeds(qloo, { seeds: input.seeds, seedLinks: [] }), { ...opts, discovery: discoveryFromConfig() });
    const picks: PlanPick[] = input.picks.map((p) => ({ ...p, rationale: "" }));
    // Only the candidate pools these picks need (thresholds and replacements come from them).
    await loadCulture(ctx, [...new Set(picks.map((p) => p.role))]);
    if (input.city) {
      ctx.city = input.city;
      if (picks.some((p) => p.role === "venue")) await loadVenues(ctx, input.city);
    } else {
      // No fixed market: rank the named cities alongside the default US metros, so a city pick is judged by rank.
      const named = picks.filter((p) => p.role === "city").map((p) => p.name);
      if (named.length) {
        const pool = [...new Set([...named, ...(PRESETS[0].brief.candidateCities ?? [])])].slice(0, 16);
        ctx.candidates.city = (await rankCities(ctx, pool)).cities;
      }
    }
    const { receipts, warnings } = await critique(ctx, picks);
    return { receipts, metrics: metricsOf(receipts), suggestions: chooseReplacements(ctx, picks, receipts, new Set()), sources: [...sources], warnings };
  } finally {
    unobserve();
  }
}
