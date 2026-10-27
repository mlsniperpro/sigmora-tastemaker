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

/**
 * diversify.by values (insights deep dive): `subtype` caps results per tag
 * subtype and applies to filter.type=urn:tag only; the geocode fields group
 * located entities by city or metro.
 */
const DIVERSIFY_GEO = ["properties.geocode.city", "properties.geocode.metro"];
const DIVERSIFY_BY: Partial<Record<string, string[]>> = {
  "urn:tag": ["subtype"],
  "urn:entity:place": DIVERSIFY_GEO,
  "urn:entity:destination": DIVERSIFY_GEO,
};
const DIVERSIFY = ["diversify.by", "diversify.take"];
/** bias.trends values the insights deep dive lists (default "medium"). */
const BIAS_TRENDS = ["off", "very_low", "low", "mid", "medium", "high", "very_high"];

/** signal.demographics.age values the insights docs enumerate (coarse and fine buckets). */
export const SIGNAL_AGE_VALUES = ["35_and_younger", "36_to_55", "24_and_younger", "25_to_29", "30_to_34", "35_to_44", "45_to_54", "55_and_older"] as const;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const BY_FILTER_TYPE: Record<string, string[]> = {
  "urn:entity:artist": [...COMMON_INSIGHTS],
  "urn:entity:book": [
    ...COMMON_INSIGHTS,
    "filter.publication_year.min",
    "filter.publication_year.max",
  ],
  "urn:entity:brand": [...COMMON_INSIGHTS],
  "urn:entity:destination": [...COMMON_INSIGHTS, ...LOCATION_FILTERS, ...DIVERSIFY],
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
    ...DIVERSIFY,
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
  // The docs list no signal.demographics.* for tags (they are dropped there).
  "urn:tag": [
    "filter.type",
    "signal.interests.entities",
    "signal.interests.tags",
    ...DIVERSIFY,
    "offset",
    "filter.tag.types",
    "filter.parents.types",
    "feature.explainability",
    "take",
    "page",
  ],
  // available-parameters-by-entity-type: no filter.results.entities, bias.trends or offset on heatmaps.
  "urn:heatmap": [
    "filter.type",
    ...SIGNALS,
    "filter.location",
    "filter.location.query",
    "filter.location.radius",
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
  ],
  "/v2/trending": ["filter.type", "signal.interests.entities", "filter.start_date", "filter.end_date", "take", "page", "offset"],
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
  // https://docs.qloo.com/reference/get-trending: filter.type and both dates are required; the entity is ours.
  "/v2/trending": ["filter.type", "signal.interests.entities", "filter.start_date", "filter.end_date"],
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
  if (bias !== undefined && !BIAS_TRENDS.includes(String(bias))) problems.push(`bias.trends "${String(bias)}" is not one of ${BIAS_TRENDS.join(", ")}`);
  if (keys.includes("diversify.take") && !keys.includes("diversify.by")) problems.push(`diversify.take needs diversify.by`);
  const div = params["diversify.by"];
  if (div !== undefined && filterType && DIVERSIFY_BY[filterType] && !DIVERSIFY_BY[filterType].includes(String(div))) {
    problems.push(`diversify.by "${String(div)}" is not valid for ${filterType} (use ${DIVERSIFY_BY[filterType].join(" or ")})`);
  }
  const ages = params["signal.demographics.age"];
  if (ages !== undefined) {
    const values = Array.isArray(ages) ? ages : String(ages).split(",");
    for (const a of values) if (!(SIGNAL_AGE_VALUES as readonly string[]).includes(a)) problems.push(`signal.demographics.age "${a}" is not a documented bucket`);
  }
  if (path === "/v2/trending") {
    for (const k of ["filter.start_date", "filter.end_date"]) {
      const v = params[k];
      if (v !== undefined && !DATE_RE.test(String(v))) problems.push(`${k} "${String(v)}" is not YYYY-MM-DD`);
    }
    const ids = params["signal.interests.entities"];
    if (Array.isArray(ids) && ids.length > 1) problems.push(`/v2/trending returns one entity's series: send one id in signal.interests.entities`);
  }
  const take = params.take;
  if (take !== undefined && path !== "/search" && path !== "/v2/tags" && (!Number.isInteger(Number(take)) || Number(take) < 1 || Number(take) > 50)) {
    problems.push(`take ${String(take)} is outside the documented 1..50`);
  }
  if (path === "/v2/analysis/compare" && params["filter.subtype"] !== undefined && !["urn:tag:occupation", "urn:tag:genre"].includes(String(params["filter.subtype"]))) {
    problems.push(`filter.subtype "${String(params["filter.subtype"])}" is not urn:tag:genre or urn:tag:occupation`);
  }
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
