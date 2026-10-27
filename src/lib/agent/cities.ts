/**
 * "Where to launch": rank the brief's candidate metros for the audience.
 *
 * A urn:heatmap over the contiguous US, conditioned on the audience, whose
 * geohash cells are folded into each candidate city; then, while fewer than
 * three metros are ranked, a heatmap inside each still-unranked metro. Locality
 * insights aren't used: the insights deep dive says urn:entity:locality "only
 * allows signal.interests.entities … when the provided entities are
 * localities", so it can't rank cities for an audience of artists and tags. We
 * don't send output.heatmap.boundary: on the hackathon host it is reported to
 * return 500 for urn:entity:locality and 400 for city (see BLOCKED.md).
 */
import { resolveByName, signalFor, type Ctx, type RankedCandidate } from "./context";
import type { HeatCell } from "./types";
import { normName, sameName } from "./util";

/** Contiguous US bounding box as WKT (longitude first). */
export const US_WKT = "POLYGON((-125 24, -66 24, -66 50, -125 50, -125 24))";
/** Cells kept for the map, in case the host returns more than asked for. */
export const MAX_MAP_CELLS = 400;
/** `take` sent on heatmap calls: the documented maximum (1..50, default 20). */
export const HEATMAP_TAKE = 50;
/** Cells within this distance of a city centre count toward it. */
export const FOLD_RADIUS_KM = 60;
/** The plan's "where to launch" needs this many ranked metros (the critic's top-3 rule). */
export const CITIES_NEEDED = 3;

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
  /** Per-metro heatmaps that came back empty, failed, or with cells outside their metro (so they rank nothing). */
  probeErrors: string[];
  /** Candidate cities neither signal ranked. */
  unranked: string[];
}

const settle = <T>(p: Promise<T>) => p.then((r) => ({ ok: true as const, r })).catch((err: unknown) => ({ ok: false as const, err }));
const message = (err: unknown) => (err instanceof Error ? err.message : String(err));
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
  const folded = heat.ok ? foldHeatmap(candidates, cells).map((c) => ({ ...c, key: heat.r.meta.key })) : [];
  folded.sort((a, b) => b.affinity - a.affinity);

  // The nationwide heatmap holds at most 50 cells, so a metro with none of the country's strongest cells near it goes
  // unranked. While that leaves fewer than the plan needs, each missing metro (up to that many) gets its own heatmap
  // inside its boundary, and ranks after every metro the nationwide signal placed: none of its cells made the top 50.
  // A reply whose cells aren't in that metro (the location filter dropped) ranks nothing.
  const probed: RankedCandidate[] = [];
  const probeErrors: string[] = [];
  if (folded.length < CITIES_NEEDED) {
    const missing = candidates.filter((c) => c.lat !== undefined && c.lon !== undefined && !folded.some((f) => f.entityId === c.entityId)).slice(0, CITIES_NEEDED - folded.length);
    const probes = await Promise.all(
      missing.map((c) => settle(ctx.qloo.insights("urn:heatmap", { ...signalFor(ctx), "filter.location": c.entityId, "filter.location.radius": 0, take: HEATMAP_TAKE }))),
    );
    probes.forEach((p, i) => {
      const c = missing[i];
      if (!c) return;
      if (!p.ok) return void probeErrors.push(`${c.name}: ${message(p.err)}`);
      const own = cellsOf(p.r.data.results.heatmap);
      const [ranked] = foldHeatmap([c], own);
      if (!ranked) return void probeErrors.push(`${c.name}: ${own.length ? "cells outside the metro" : "no cells"}`);
      probed.push({ ...ranked, key: p.r.meta.key });
    });
    probed.sort((a, b) => b.affinity - a.affinity);
  }
  const cities = [...folded, ...probed];
  const placed = new Set(cities.map((c) => c.entityId));
  return {
    cities,
    heatmap: topCells(cells),
    rankedBy: cities.length ? "heatmap" : "none",
    heatmapError: heat.ok ? undefined : message(heat.err),
    probeErrors,
    unranked: candidates.filter((c) => !placed.has(c.entityId)).map((c) => c.name),
  };
}
