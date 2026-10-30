/**
 * "Where to launch": rank the brief's candidate metros for the audience.
 *
 * A urn:heatmap over the contiguous US, conditioned on the audience, whose
 * geohash cells are folded into each candidate city: one call, so every metro
 * is on the same scale (Qloo doesn't document whether heatmap affinities
 * compare across calls). A city outside the candidates is judged against the
 * same cells (critic.ts). Locality
 * insights aren't used: the insights deep dive says urn:entity:locality "only
 * allows signal.interests.entities … when the provided entities are
 * localities", so it can't rank cities for an audience of artists and tags. We
 * don't send output.heatmap.boundary: on the hackathon host it was reported (unverified) to
 * return 500 for urn:entity:locality and 400 for city (see BLOCKED.md).
 */
import { publicErrorText } from "../net";
import { resolveByName, signalFor, type Ctx, type RankedCandidate } from "./context";
import type { HeatCell } from "./types";
import { normName, sameName } from "./util";

/** Contiguous US bounding box as WKT (longitude first). */
export const US_WKT = "POLYGON((-125 24, -66 24, -66 50, -125 50, -125 24))";
/** Cells kept for the map, in case the host returns more than asked for. */
export const MAX_MAP_CELLS = 400;
/** `take` sent on heatmap calls: the insights maximum (1..50, default 20); the heatmap docs list no take of their own (BLOCKED #9). */
export const HEATMAP_TAKE = 50;
/** Cells within this distance of a city centre count toward it. */
export const FOLD_RADIUS_KM = 60;

const toRad = (d: number) => (d * Math.PI) / 180;

export function haversineKm(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Mean affinity of the cells around each city; cities with no nearby cell are dropped. */
export function foldHeatmap<C extends { lat?: number; lon?: number; affinity: number }>(cities: readonly C[], cells: readonly HeatCell[], radiusKm = FOLD_RADIUS_KM): C[] {
  return cities.flatMap((c) => {
    if (c.lat === undefined || c.lon === undefined) return [];
    const at = { lat: c.lat, lon: c.lon };
    const near = cells.filter((cell) => haversineKm(at, cell) <= radiusKm);
    if (!near.length) return [];
    return [{ ...c, affinity: Math.round((near.reduce((s, x) => s + x.affinity, 0) / near.length) * 1000) / 1000 }];
  });
}

/** Keep the strongest cells for the map, bounded. */
export function topCells(cells: readonly HeatCell[], max = MAX_MAP_CELLS): HeatCell[] {
  return [...cells].sort((a, b) => b.affinity - a.affinity).slice(0, max);
}

export interface CityRanking {
  /** Ranked candidate metros, best first; each carries the request that ranked it. */
  cities: RankedCandidate[];
  heatmap: HeatCell[];
  rankedBy: "heatmap" | "none";
  heatmapError?: string;
  /** The nationwide heatmap's request key, for receipts that judge a city against its cells. */
  heatmapKey?: string;
  /** Candidate cities neither signal ranked. */
  unranked: string[];
}

const settle = <T>(p: Promise<T>) => p.then((r) => ({ ok: true as const, r })).catch((err: unknown) => ({ ok: false as const, err }));
const message = (err: unknown) => publicErrorText(err);
const cellsOf = (heatmap: readonly { location: { latitude: number; longitude: number }; query: { affinity?: number | null } }[] | undefined): HeatCell[] =>
  (heatmap ?? []).flatMap((c) => (typeof c.query.affinity === "number" ? [{ lat: c.location.latitude, lon: c.location.longitude, affinity: c.query.affinity }] : []));

/**
 * Ranks the candidate metros for the audience. `exact` names (cities a plan
 * under audit names, not ones the user typed) count only on an exact Qloo
 * match: search returns a top hit even for an invented name, and a made-up
 * city must not borrow a real one's rank.
 */
export async function rankCities(ctx: Ctx, candidateCities: readonly string[], opts: { exact?: readonly string[] } = {}): Promise<CityRanking> {
  const exact = new Set((opts.exact ?? []).map(normName));
  const found = await Promise.all(
    candidateCities.map(async (name) => {
      const strict = exact.has(normName(name));
      const { hit } = await resolveByName(ctx.qloo, name, { types: ["locality"], take: 3, acceptTop: !strict });
      if (!hit || (strict && !sameName(hit.name, name))) return undefined;
      return { name, type: "locality" as const, affinity: 0, entityId: hit.entity_id, lat: hit.location?.lat, lon: hit.location?.lon };
    }),
  );
  // Two names for one place ("New York", "NYC") are one candidate: the first name given is kept.
  const candidates = found.filter((c, i): c is NonNullable<typeof c> => !!c && found.findIndex((d) => d?.entityId === c.entityId) === i);
  const heat = await settle(ctx.qloo.insights("urn:heatmap", { ...signalFor(ctx), "filter.location": US_WKT, take: HEATMAP_TAKE }));
  const cells = heat.ok ? cellsOf(heat.r.data.results.heatmap) : [];
  // One call, one scale: every metro is measured against the same nationwide reply. A metro none of the audience's
  // strongest cells reach stays unranked rather than being scored by a separate call whose values may not compare.
  const cities = heat.ok ? foldHeatmap(candidates, cells).map((c) => ({ ...c, key: heat.r.meta.key })) : [];
  cities.sort((a, b) => b.affinity - a.affinity);
  const placed = new Set(cities.map((c) => c.entityId));
  return {
    cities,
    heatmap: topCells(cells),
    ...(heat.ok ? { heatmapKey: heat.r.meta.key } : {}),
    rankedBy: cities.length ? "heatmap" : "none",
    heatmapError: heat.ok ? undefined : message(heat.err),
    unranked: candidates.filter((c) => !placed.has(c.entityId)).map((c) => c.name),
  };
}

/**
 * Adds a city the plan names to the ranked candidates, measured on the run's nationwide heatmap (no new insights
 * call). Only an exact Qloo match counts, so an invented city can't borrow a real one's rank; a city none of the
 * audience's strongest cells reach isn't added (the critic then calls it a measured miss).
 */
export async function rankPlanCity(ctx: Ctx, name: string): Promise<void> {
  const heat = ctx.cityHeat;
  if (!heat) return;
  const { hit } = await resolveByName(ctx.qloo, name, { types: ["locality"], take: 3 });
  const { lat, lon } = hit?.location ?? {};
  if (!hit || lat === undefined || lon === undefined || ctx.candidates.city?.some((c) => c.entityId === hit.entity_id)) return;
  const [folded] = foldHeatmap([{ name, type: "locality" as const, affinity: 0, entityId: hit.entity_id, lat, lon }], heat.cells);
  if (!folded) return;
  ctx.candidates.city = [...(ctx.candidates.city ?? []), { ...folded, key: heat.key }].sort((a, b) => b.affinity - a.affinity);
}
