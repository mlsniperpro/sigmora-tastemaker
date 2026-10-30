import { z } from "zod";

/**
 * Response shapes for the Qloo hackathon API, following the public docs
 * (https://docs.qloo.com/reference). Schemas are deliberately lenient
 * (`.loose()`, optional fields): the API adds fields over time and we only
 * depend on the ones listed. Anything we have not yet verified against a live
 * response is listed in BLOCKED.md.
 */

export const ENTITY_TYPES = [
  "artist",
  "book",
  "brand",
  "destination",
  "movie",
  "person",
  "place",
  "podcast",
  "tv_show",
  "video_game",
  "locality",
] as const;
export type EntityType = (typeof ENTITY_TYPES)[number];

export const entityUrn = (t: EntityType) => `urn:entity:${t}` as const;

/** filter.type values for /v2/insights, including the analysis types. */
export type InsightsFilterType =
  | ReturnType<typeof entityUrn>
  | "urn:demographics"
  | "urn:heatmap"
  | "urn:tag";

/** One input signal's share of a result's score (an item of `query.explainability["signal.interests.entities"]`). */
export const ExplainabilityDriver = z
  .object({
    entity_id: z.string().optional(),
    tag_id: z.string().optional(),
    name: z.string().optional(),
    score: z.number(),
  })
  .loose();
export type ExplainabilityDriver = z.infer<typeof ExplainabilityDriver>;

/**
 * `query.explainability` is read leniently. The insights deep dive
 * (https://docs.qloo.com/reference/insights-api-deep-dive) says that when it
 * can't be computed "a warning is returned under `query.explainability.warning`"
 * (a string, not a driver list) and the results still come back. A strict
 * record-of-arrays schema rejected that whole reply, so the values stay
 * unknown here and explainabilityOf() reads the parts we use.
 */
export const Explainability = z.unknown().optional();

export const EntityQuery = z
  .object({
    // null as well as absent: either way the entity is unscored, never given a made-up 0.
    affinity: z.number().nullish(),
    rank: z.number().nullish(),
    explainability: Explainability,
  })
  .loose();

/**
 * The entity drivers and any warning in a result's `query.explainability`.
 * Drivers that don't match the documented shape are dropped one by one. With
 * a warning no driver split is returned: Qloo said it couldn't compute one.
 */
export function explainabilityOf(raw: unknown): { drivers: ExplainabilityDriver[]; warning?: string } {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return { drivers: [] };
  const fields = raw as Record<string, unknown>;
  const warning = typeof fields.warning === "string" && fields.warning.trim() ? fields.warning.trim() : undefined;
  if (warning) return { drivers: [], warning };
  const list = z.array(z.unknown()).safeParse(fields["signal.interests.entities"]);
  if (!list.success) return { drivers: [] };
  return {
    drivers: list.data.flatMap((d) => {
      const r = ExplainabilityDriver.safeParse(d);
      return r.success ? [r.data] : [];
    }),
  };
}

/** An optional field a live reply may also send as null: read as absent, so one null can't fail a whole reply. */
const absent = <T extends z.ZodType>(t: T) => t.nullish().transform((v) => v ?? undefined).optional();

/** A list whose malformed items are dropped one by one, so one odd item (a live tag with no name) can't fail a whole reply. */
const each = <T extends z.ZodType>(t: T) =>
  z.array(z.unknown()).transform((items) =>
    items.flatMap((item) => {
      const r = t.safeParse(item);
      return r.success ? [r.data] : [];
    }),
  );

export const Tag = z
  .object({
    id: absent(z.string()),
    tag_id: absent(z.string()),
    name: z.string(),
    type: absent(z.string()),
    subtype: absent(z.string()),
    query: absent(z.object({ affinity: z.number().nullish() }).loose()),
  })
  .loose();
export type Tag = z.infer<typeof Tag>;

/**
 * A location with `lon` (or Qloo's documented `lng`), put back when the two values come swapped: an
 * out-of-range latitude, or a US point written (lon, lat) as in the heatmaps use-case's New York
 * (lat -73.9, lng 40.7). Nothing real lies south of -60 at those longitudes but Antarctica, and every
 * place these are read for (candidate metros, city picks) is judged against a US heatmap.
 */
export function latLon<T extends { lat?: number; lon?: number; lng?: number }>(v: T): T & { lat?: number; lon?: number } {
  const lon = v.lon ?? v.lng;
  if (v.lat === undefined || lon === undefined) return { ...v, lon };
  const outOfRange = Math.abs(v.lat) > 90 && Math.abs(lon) <= 90;
  const usBackwards = v.lat <= -60 && v.lat >= -180 && lon >= 15 && lon <= 72;
  return outOfRange || usBackwards ? { ...v, lat: lon, lon: v.lat } : { ...v, lon };
}

export const Entity = z
  .object({
    name: z.string(),
    entity_id: z.string(),
    type: absent(z.string()),
    subtype: absent(z.string()),
    types: absent(z.array(z.string())),
    popularity: absent(z.number()),
    properties: absent(z.record(z.string(), z.unknown())),
    // Qloo's heatmap use-case doc shows a locality as { lat, lng } with the two values swapped; read either key
    // and put an out-of-range latitude back, so a metro is never dropped for its spelling.
    location: z
      .object({ lat: absent(z.number()), lon: absent(z.number()), lng: absent(z.number()) })
      .loose()
      .nullish()
      .transform((v) => (v ? latLon(v) : undefined))
      .optional(),
    tags: absent(each(Tag)),
    external: absent(z.record(z.string(), z.unknown())),
    query: absent(EntityQuery),
  })
  .loose();
export type Entity = z.infer<typeof Entity>;

/** GET /search and GET /entities */
export const SearchResponse = z
  .object({ results: z.array(Entity).nullish().transform((v) => v ?? []) })
  .loose();
export type SearchResponse = z.infer<typeof SearchResponse>;

export { AGE_BUCKETS, type AgeBucket } from "../vocab";

export const DemographicsRow = z
  .object({
    entity_id: absent(z.string()),
    query: z
      .object({
        age: absent(z.record(z.string(), z.number())),
        gender: absent(z.record(z.string(), z.number())),
      })
      .loose(),
  })
  .loose();

export const HeatmapCell = z
  .object({
    location: z
      .object({
        latitude: z.number(),
        longitude: z.number(),
        geohash: absent(z.string()),
        name: absent(z.string()),
        entity_id: absent(z.string()),
      })
      .loose(),
    query: z
      .object({
        affinity: z.number().nullish(),
        affinity_rank: z.number().nullish(),
        popularity: absent(z.number()),
      })
      .loose(),
  })
  .loose();
export type HeatmapCell = z.infer<typeof HeatmapCell>;

/** GET /v2/insights (all filter.type values) and GET /v2/trending */
export const InsightsResponse = z
  .object({
    success: z.boolean().optional(),
    results: z
      .object({
        entities: absent(z.array(Entity)),
        tags: absent(each(Tag)),
        demographics: absent(z.array(DemographicsRow)),
        heatmap: absent(z.array(HeatmapCell)),
      })
      .loose()
      .nullish()
      .transform((v) => v ?? {}),
    duration: z.number().optional(),
  })
  .loose();
export type InsightsResponse = z.infer<typeof InsightsResponse>;

/**
 * One weekly point of GET /v2/trending (https://docs.qloo.com/reference/get-trending):
 * a date series for the one entity in `signal.interests.entities`, newest first.
 * The docs give types and examples but no descriptions; `population_percent_delta`
 * is the field the critic reads (its sign is unambiguous: negative = losing share).
 */
export const TrendPoint = z
  .object({
    date: z.string(),
    population_percentile: absent(z.number()),
    population_rank: absent(z.number().int()),
    population_rank_velocity: absent(z.number().int()),
    velocity_fold_change: absent(z.number()),
    population_percent_delta: absent(z.number()),
  })
  .loose();
export type TrendPoint = z.infer<typeof TrendPoint>;

/** GET /v2/trending */
export const TrendingResponse = z
  .object({
    success: z.boolean().optional(),
    results: z.object({ trending: z.array(TrendPoint).nullish().transform((v) => v ?? []) }).loose().nullish().transform((v) => v ?? { trending: [] }),
    duration: z.number().optional(),
  })
  .loose();
export type TrendingResponse = z.infer<typeof TrendingResponse>;

/** The newest point that carries a percent delta, or undefined (dates are YYYY-MM-DD, so they sort as strings). */
export function latestTrend(points: readonly TrendPoint[]): (TrendPoint & { population_percent_delta: number }) | undefined {
  let best: (TrendPoint & { population_percent_delta: number }) | undefined;
  for (const p of points) {
    const d = p.population_percent_delta;
    if (typeof d !== "number" || !Number.isFinite(d)) continue;
    if (!best || p.date > best.date) best = { ...p, population_percent_delta: d };
  }
  return best;
}

const CompareSide = z.object({ affinity: z.number().nullish() }).loose().nullish();

/**
 * One compared item. The docs type `results` as an array of entity-shaped
 * objects (Common.yml) and publish no example, so only the name is required;
 * the per-side affinities are read when present and never invented.
 */
export const CompareItem = z
  .object({
    name: z.string(),
    tag_id: absent(z.string()),
    id: absent(z.string()),
    entity_id: absent(z.string()),
    type: absent(z.string()),
    subtype: absent(z.string()),
    query: z
      .object({
        a: CompareSide,
        b: CompareSide,
        delta: absent(z.number()),
      })
      .loose()
      .nullish()
      .transform((v) => v ?? undefined)
      .optional(),
  })
  .loose();
export type CompareItem = z.infer<typeof CompareItem>;

/**
 * GET /v2/analysis/compare (https://docs.qloo.com/reference/analysis-compare).
 * Documented: `results` is an array. Also accepted until a live recording
 * settles it: the older `results.tags[]` object form.
 */
export const CompareResponse = z
  .object({
    success: z.boolean().optional(),
    results: z.union([z.array(CompareItem), z.object({ tags: absent(z.array(CompareItem)) }).loose()]).nullish().transform((v) => v ?? []),
    duration: z.number().optional(),
  })
  .loose();
export type CompareResponse = z.infer<typeof CompareResponse>;

/** The compared items, whichever of the two accepted forms the reply used. */
export const compareItems = (r: CompareResponse): CompareItem[] => (Array.isArray(r.results) ? r.results : (r.results.tags ?? []));
