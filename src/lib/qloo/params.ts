/**
 * Parameter allow-lists per endpoint and per `filter.type`.
 *
 * Why: the Qloo API silently drops unsupported parameters and answers 200
 * with empty results. A typo or a wrong-type filter therefore looks like
 * "Qloo has no data". We validate every request before it leaves the server
 * and fail loudly outside production.
 *
 * Source: https://docs.qloo.com/reference/available-parameters-by-entity-type
 * and https://docs.qloo.com/reference/parameters. Lists not yet confirmed
 * against live responses are tracked in BLOCKED.md.
 */

export type QlooPath =
  | "/search"
  | "/entities"
  | "/v2/insights"
  | "/v2/trending"
  | "/v2/tags"
  | "/v2/analysis/compare";

export type ParamValue = string | number | boolean | string[];
export type QlooParams = Record<string, ParamValue | undefined>;

const SIGNALS = [
  "signal.interests.entities",
  "signal.interests.tags",
  "signal.demographics.age",
  "signal.demographics.gender",
  "signal.demographics.audiences",
  "signal.location",
  "signal.location.query",
  "signal.location.radius",
];

const COMMON_INSIGHTS = [
  "filter.type",
  ...SIGNALS,
  "bias.trends",
  "diversify.by",
  "diversify.take",
  "feature.explainability",
  "filter.results.entities",
  "filter.exclude.entities",
  "filter.tags",
  "filter.exclude.tags",
  "filter.popularity.min",
  "filter.popularity.max",
  "take",
  "page",
  "offset",
];

const LOCATION_FILTERS = [
  "filter.location",
  "filter.location.query",
  "filter.location.radius",
  "filter.geocode.name",
  "filter.geocode.admin1_region",
  "filter.geocode.admin2_region",
  "filter.geocode.country_code",
];

const BY_FILTER_TYPE: Record<string, string[]> = {
  "urn:entity:artist": [...COMMON_INSIGHTS],
  "urn:entity:book": [
    ...COMMON_INSIGHTS,
    "filter.publication_year.min",
    "filter.publication_year.max",
  ],
  "urn:entity:brand": [...COMMON_INSIGHTS],
  "urn:entity:destination": [...COMMON_INSIGHTS, ...LOCATION_FILTERS],
  "urn:entity:movie": [
    ...COMMON_INSIGHTS,
    "filter.release_year.min",
    "filter.release_year.max",
    "filter.content_rating",
    "filter.rating.min",
    "filter.release_country",
  ],
  "urn:entity:person": [...COMMON_INSIGHTS],
  "urn:entity:place": [
    ...COMMON_INSIGHTS,
    ...LOCATION_FILTERS,
    "filter.price_level.min",
    "filter.price_level.max",
    "filter.properties.business_rating.min",
    "filter.properties.business_rating.max",
  ],
  "urn:entity:podcast": [...COMMON_INSIGHTS],
  "urn:entity:tv_show": [
    ...COMMON_INSIGHTS,
    "filter.release_year.min",
    "filter.release_year.max",
    "filter.content_rating",
    "filter.rating.min",
    "filter.finale_year.min",
    "filter.finale_year.max",
  ],
  "urn:entity:video_game": [...COMMON_INSIGHTS],
  "urn:entity:locality": [...COMMON_INSIGHTS, ...LOCATION_FILTERS],
  "urn:demographics": ["filter.type", ...SIGNALS, "take"],
  "urn:tag": [
    "filter.type",
    ...SIGNALS,
    "filter.tag.types",
    "filter.parents.types",
    "feature.explainability",
    "take",
    "page",
  ],
  "urn:heatmap": [
    "filter.type",
    ...SIGNALS,
    ...LOCATION_FILTERS,
    "output.heatmap.boundary",
    "take",
  ],
};

const BY_PATH: Record<Exclude<QlooPath, "/v2/insights">, string[]> = {
  "/search": ["query", "types", "filter.location", "filter.radius", "take", "page", "filter.popularity"],
  "/entities": [
    "entity_ids",
    "external.spotify.ids",
    "external.imdb.ids",
    "external.isbn.ids",
    "external.tmdb.ids",
  ],
  "/v2/trending": ["filter.type", "signal.interests.entities", "filter.start_date", "filter.end_date", "take", "page"],
  "/v2/tags": ["filter.query", "filter.tag.types", "filter.parents.types", "feature.semantic_search", "take", "page"],
  "/v2/analysis/compare": [
    "a.signal.interests.entities",
    "b.signal.interests.entities",
    "filter.type",
    "filter.subtype",
    "take",
    "page",
  ],
};

/** Parameters that must be present for a request to make sense. */
const REQUIRED: Partial<Record<string, string[]>> = {
  "/search": ["query"],
  "/v2/insights": ["filter.type"],
  "/v2/trending": ["filter.type", "signal.interests.entities"],
  "/v2/analysis/compare": ["a.signal.interests.entities", "b.signal.interests.entities"],
  "urn:entity:destination": ["signal.interests.entities"],
};

export class QlooParamError extends Error {
  constructor(
    message: string,
    public readonly path: QlooPath,
    public readonly bad: string[],
  ) {
    super(message);
    this.name = "QlooParamError";
  }
}

export function allowedParams(path: QlooPath, filterType?: string): string[] {
  if (path === "/v2/insights") {
    if (!filterType) return ["filter.type"];
    return BY_FILTER_TYPE[filterType] ?? [];
  }
  return BY_PATH[path];
}

/** Returns the list of problems; empty means valid. */
export function checkParams(path: QlooPath, params: QlooParams): string[] {
  const problems: string[] = [];
  const keys = Object.keys(params).filter((k) => params[k] !== undefined);
  const ft = params["filter.type"];
  const filterType = typeof ft === "string" ? ft : undefined;
  if (path === "/v2/insights" && filterType && !BY_FILTER_TYPE[filterType]) {
    problems.push(`unknown filter.type "${filterType}"`);
    return problems;
  }
  const allowed = new Set(allowedParams(path, filterType));
  for (const k of keys) {
    if (!allowed.has(k)) problems.push(`"${k}" is not supported for ${path}${filterType ? ` (${filterType})` : ""}`);
  }
  for (const r of [...(REQUIRED[path] ?? []), ...(filterType ? REQUIRED[filterType] ?? [] : [])]) {
    if (!keys.includes(r)) problems.push(`"${r}" is required for ${path}${filterType ? ` (${filterType})` : ""}`);
  }
  if (path === "/entities" && !keys.some((k) => k === "entity_ids" || k.startsWith("external."))) {
    problems.push(`/entities needs entity_ids or an external.*.ids parameter`);
  }
  const bias = params["bias.trends"];
  if (bias !== undefined && bias !== "low" && bias !== "medium" && bias !== "high") problems.push(`bias.trends "${String(bias)}" is not low, medium or high`);
  if (keys.includes("diversify.take") && !keys.includes("diversify.by")) problems.push(`diversify.take needs diversify.by`);
  if (keys.includes("output.heatmap.boundary")) {
    const v = params["output.heatmap.boundary"];
    if (v !== "urn:entity:locality" && v !== "geohashes" && v !== "city" && v !== "neighborhood") {
      problems.push(`output.heatmap.boundary "${String(v)}" is not a known boundary`);
    }
  }
  return problems;
}

/** Throws outside production; in production the caller logs and continues. */
export function assertParams(path: QlooPath, params: QlooParams, strict = process.env.NODE_ENV !== "production"): string[] {
  const problems = checkParams(path, params);
  if (problems.length && strict) {
    throw new QlooParamError(`Invalid Qloo request to ${path}: ${problems.join("; ")}`, path, problems);
  }
  return problems;
}

/** Stable, credential-free representation of a request; used as cache and fixture key. */
export function requestKey(path: QlooPath, params: QlooParams): string {
  const parts = Object.entries(params)
    .flatMap(([k, v]) => (v === undefined ? [] : [[k, Array.isArray(v) ? v.join(",") : String(v)] as const]))
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, s]) => `${encodeURIComponent(k)}=${encodeURIComponent(s)}`);
  return parts.length ? `${path}?${parts.join("&")}` : path;
}
