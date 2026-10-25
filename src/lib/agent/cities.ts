/**
 * "Where to launch": rank the brief's candidate metros for the audience.
 *
 * Primary signal: /v2/insights on urn:entity:locality restricted to the
 * candidates. Map and fallback ranking: a urn:heatmap over the contiguous US,
 * whose geohash cells are folded into each candidate city. We don't send
 * output.heatmap.boundary: on the hackathon host it is reported to return 500
 * for urn:entity:locality and 400 for city (see BLOCKED.md).
 */
import { resolveByName, signalFor, type Ctx, type RankedCandidate } from "./context";
import type { HeatCell } from "./types";

/** Contiguous US bounding box as WKT (longitude first). */
export const US_WKT = "POLYGON((-125 24, -66 24, -66 50, -125 50, -125 24))";
/** Cells kept for the map, in case the host returns more than asked for. */
export const MAX_MAP_CELLS = 400;
/** `take` sent on heatmap calls: the documented maximum (1..50, default 20). */
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
  rankedBy: "locality" | "heatmap" | "none";
  heatmapError?: string;
  /** Set when the locality ranking call failed (the heatmap fold then ranks the cities, if it loaded). */
  localityError?: string;
}

const settle = <T>(p: Promise<T>) => p.then((r) => ({ ok: true as const, r })).catch((err: unknown) => ({ ok: false as const, err }));
const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

export async function rankCities(ctx: Ctx, candidateCities: readonly string[]): Promise<CityRanking> {
  const found = await Promise.all(
    candidateCities.map(async (name) => {
      const { hit } = await resolveByName(ctx.qloo, name, { types: ["locality"], take: 3, acceptTop: true });
      return hit && { name, type: "locality" as const, affinity: 0, entityId: hit.entity_id, lat: hit.location?.lat, lon: hit.location?.lon };
    }),
  );
  const candidates = found.filter((c): c is NonNullable<typeof c> => !!c);
  const ids = candidates.map((c) => c.entityId);
  // Both settle: a failed locality ranking must not throw away the heatmap that would rank the cities instead.
  const [locality, heat] = await Promise.all([
    ids.length ? settle(ctx.qloo.insights("urn:entity:locality", { ...signalFor(ctx), "filter.results.entities": ids, take: ids.length })) : undefined,
    settle(ctx.qloo.insights("urn:heatmap", { ...signalFor(ctx), "filter.location": US_WKT, take: HEATMAP_TAKE })),
  ]);
  const ranked = locality?.ok ? locality.r : undefined;

  const cells: HeatCell[] = heat.ok
    ? (heat.r.data.results.heatmap ?? []).flatMap((c) =>
        typeof c.query.affinity === "number" ? [{ lat: c.location.latitude, lon: c.location.longitude, affinity: c.query.affinity }] : [],
      )
    : [];

  const byLocality: RankedCandidate[] = ranked
    ? (ranked.data.results.entities ?? []).flatMap((e) => {
        const src = candidates.find((c) => c.entityId === e.entity_id);
        const affinity = e.query?.affinity;
        return src && typeof affinity === "number" ? [{ ...src, affinity, key: ranked.meta.key, lat: src.lat ?? e.location?.lat, lon: src.lon ?? e.location?.lon }] : [];
      })
    : [];
  const cities = byLocality.length ? byLocality : heat.ok ? foldHeatmap(candidates, cells).map((c) => ({ ...c, key: heat.r.meta.key })) : [];
  return {
    cities: cities.sort((a, b) => b.affinity - a.affinity),
    heatmap: topCells(cells),
    rankedBy: byLocality.length ? "locality" : cities.length ? "heatmap" : "none",
    heatmapError: heat.ok ? undefined : message(heat.err),
    localityError: locality && !locality.ok ? message(locality.err) : undefined,
  };
}
