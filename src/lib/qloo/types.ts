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

export const Tag = z
  .object({
    id: z.string().optional(),
    tag_id: z.string().optional(),
    name: z.string(),
    type: z.string().optional(),
    subtype: z.string().optional(),
    query: z.object({ affinity: z.number().nullish() }).loose().optional(),
  })
  .loose();
export type Tag = z.infer<typeof Tag>;

export const Entity = z
  .object({
    name: z.string(),
    entity_id: z.string(),
    type: z.string().optional(),
    subtype: z.string().optional(),
    types: z.array(z.string()).optional(),
    popularity: z.number().optional(),
    properties: z.record(z.string(), z.unknown()).optional(),
    location: z
      .object({ lat: z.number().optional(), lon: z.number().optional() })
      .loose()
      .optional(),
    tags: z.array(Tag).optional(),
    external: z.record(z.string(), z.unknown()).optional(),
    query: EntityQuery.optional(),
  })
  .loose();
export type Entity = z.infer<typeof Entity>;

/** GET /search and GET /entities */
export const SearchResponse = z
  .object({ results: z.array(Entity).default([]) })
  .loose();
export type SearchResponse = z.infer<typeof SearchResponse>;

export { AGE_BUCKETS, type AgeBucket } from "../vocab";

export const DemographicsRow = z
  .object({
    entity_id: z.string().optional(),
    query: z
      .object({
        age: z.record(z.string(), z.number()).optional(),
        gender: z.record(z.string(), z.number()).optional(),
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
        geohash: z.string().optional(),
        name: z.string().optional(),
        entity_id: z.string().optional(),
      })
      .loose(),
    query: z
      .object({
        affinity: z.number().nullish(),
        affinity_rank: z.number().nullish(),
        popularity: z.number().optional(),
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
        entities: z.array(Entity).optional(),
        tags: z.array(Tag).optional(),
        demographics: z.array(DemographicsRow).optional(),
        heatmap: z.array(HeatmapCell).optional(),
      })
      .loose()
      .default({}),
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
    population_percentile: z.number().optional(),
    population_rank: z.number().int().optional(),
    population_rank_velocity: z.number().int().optional(),
    velocity_fold_change: z.number().optional(),
    population_percent_delta: z.number().optional(),
  })
  .loose();
export type TrendPoint = z.infer<typeof TrendPoint>;

/** GET /v2/trending */
export const TrendingResponse = z
  .object({
    success: z.boolean().optional(),
    results: z.object({ trending: z.array(TrendPoint).default([]) }).loose().default({ trending: [] }),
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
    tag_id: z.string().optional(),
    id: z.string().optional(),
    entity_id: z.string().optional(),
    type: z.string().optional(),
    subtype: z.string().optional(),
    query: z
      .object({
        a: CompareSide,
        b: CompareSide,
        delta: z.number().optional(),
      })
      .loose()
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
    results: z.union([z.array(CompareItem), z.object({ tags: z.array(CompareItem).optional() }).loose()]).default([]),
    duration: z.number().optional(),
  })
  .loose();
export type CompareResponse = z.infer<typeof CompareResponse>;

/** The compared items, whichever of the two accepted forms the reply used. */
export const compareItems = (r: CompareResponse): CompareItem[] => (Array.isArray(r.results) ? r.results : (r.results.tags ?? []));
