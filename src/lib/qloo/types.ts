import { z } from "zod";

/**
 * Response shapes for the Qloo hackathon API, following the public docs
 * (https://docs.qloo.com/reference). Schemas are deliberately lenient
 * (`passthrough`, optional fields): the API adds fields over time and we only
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

export const Explainability = z
  .record(
    z.string(),
    z.array(
      z
        .object({
          entity_id: z.string().optional(),
          tag_id: z.string().optional(),
          name: z.string().optional(),
          score: z.number(),
        })
        .passthrough(),
    ),
  )
  .optional();

export const EntityQuery = z
  .object({
    affinity: z.number().optional(),
    rank: z.number().optional(),
    explainability: Explainability,
    // Trending fields (/v2/trending)
    population_percentile: z.number().optional(),
    population_rank: z.number().optional(),
    population_rank_velocity: z.number().optional(),
    trending_percentile: z.number().optional(),
  })
  .passthrough();

export const Tag = z
  .object({
    id: z.string().optional(),
    tag_id: z.string().optional(),
    name: z.string(),
    type: z.string().optional(),
    subtype: z.string().optional(),
    query: z.object({ affinity: z.number().optional() }).passthrough().optional(),
  })
  .passthrough();
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
      .passthrough()
      .optional(),
    tags: z.array(Tag).optional(),
    external: z.record(z.string(), z.unknown()).optional(),
    query: EntityQuery.optional(),
  })
  .passthrough();
export type Entity = z.infer<typeof Entity>;

/** GET /search and GET /entities */
export const SearchResponse = z
  .object({ results: z.array(Entity).default([]) })
  .passthrough();
export type SearchResponse = z.infer<typeof SearchResponse>;

export const AGE_BUCKETS = [
  "24_and_younger",
  "25_to_29",
  "30_to_34",
  "35_to_44",
  "45_to_54",
  "55_and_older",
] as const;
export type AgeBucket = (typeof AGE_BUCKETS)[number];

export const DemographicsRow = z
  .object({
    entity_id: z.string().optional(),
    query: z
      .object({
        age: z.record(z.string(), z.number()).optional(),
        gender: z.record(z.string(), z.number()).optional(),
      })
      .passthrough(),
  })
  .passthrough();

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
      .passthrough(),
    query: z
      .object({
        affinity: z.number().optional(),
        affinity_rank: z.number().optional(),
        popularity: z.number().optional(),
      })
      .passthrough(),
  })
  .passthrough();
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
      .passthrough()
      .default({}),
    duration: z.number().optional(),
  })
  .passthrough();
export type InsightsResponse = z.infer<typeof InsightsResponse>;

/** GET /v2/analysis/compare */
export const CompareResponse = z
  .object({
    success: z.boolean().optional(),
    results: z
      .object({
        tags: z
          .array(
            z
              .object({
                name: z.string(),
                tag_id: z.string().optional(),
                subtype: z.string().optional(),
                query: z
                  .object({
                    a: z.object({ affinity: z.number() }).passthrough().optional(),
                    b: z.object({ affinity: z.number() }).passthrough().optional(),
                    delta: z.number().optional(),
                  })
                  .passthrough()
                  .optional(),
              })
              .passthrough(),
          )
          .optional(),
      })
      .passthrough()
      .default({}),
  })
  .passthrough();
export type CompareResponse = z.infer<typeof CompareResponse>;
