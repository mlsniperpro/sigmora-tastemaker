/**
 * Offline stand-in for the Qloo hackathon API.
 *
 * It answers the same paths and parameters as the real API, in the documented
 * response shapes, from the hand-set catalog in ./catalog.ts. It exists so the
 * product, the tests and the hosted demo run with zero credentials. Its
 * numbers are placeholders, not Qloo data, and every response is labeled
 * `source: "simulated"` by the client.
 */
import type { QlooParams, QlooPath } from "../params";
import { AGE_BUCKETS } from "../types";
import { CATALOG, DIMS, TAGS, byId, type SimEntity, type Vec } from "./catalog";

const list = (v: QlooParams[string]): string[] =>
  v === undefined ? [] : Array.isArray(v) ? v.map(String) : String(v).split(",").map((s) => s.trim()).filter(Boolean);

const norm = (v: Vec) => Math.sqrt(DIMS.reduce((s, d) => s + (v[d] ?? 0) ** 2, 0)) || 1;
const cos = (a: Vec, b: Vec) => DIMS.reduce((s, d) => s + (a[d] ?? 0) * (b[d] ?? 0), 0) / (norm(a) * norm(b));

function hash01(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return ((h >>> 0) % 10000) / 10000;
}

const AGE_POS: Record<string, number[]> = {
  "24_and_younger": [0],
  "25_to_29": [0.2],
  "30_to_34": [0.4],
  "35_to_44": [0.6],
  "45_to_54": [0.8],
  "55_and_older": [1],
  "35_and_younger": [0, 0.2, 0.4],
  "36_to_55": [0.6, 0.8],
};

interface Audience {
  seeds: SimEntity[];
  vec: Vec;
  age?: number;
  fem?: number;
}

function audienceFrom(params: QlooParams, prefix = "signal"): Audience {
  const seeds = list(params[`${prefix}.interests.entities`])
    .map((id) => byId.get(id))
    .filter((e): e is SimEntity => !!e);
  const vec: Vec = {};
  for (const s of seeds) for (const d of DIMS) vec[d] = (vec[d] ?? 0) + (s.v[d] ?? 0) / norm(s.v);
  const tagIds = list(params[`${prefix}.interests.tags`]);
  for (const t of TAGS.filter((t) => tagIds.includes(t.id))) vec[t.dim] = (vec[t.dim] ?? 0) + 0.6;
  const ages = list(params[`${prefix}.demographics.age`]).flatMap((b) => AGE_POS[b] ?? []);
  const gender = params[`${prefix}.demographics.gender`];
  return {
    seeds,
    vec,
    age: ages.length ? ages.reduce((a, b) => a + b, 0) / ages.length : seeds.length ? avg(seeds.map((s) => s.age)) : undefined,
    fem: gender === "female" ? 0.8 : gender === "male" ? -0.8 : undefined,
  };
}

const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / (xs.length || 1);
const r3 = (x: number) => Math.round(x * 1000) / 1000;

function affinity(a: Audience, e: { id: string; v: Vec; age?: number; fem?: number }): number {
  let score = 0.08 + 0.85 * cos(a.vec, e.v);
  if (a.age !== undefined && e.age !== undefined) score -= 0.35 * Math.abs(a.age - e.age);
  if (a.fem !== undefined && e.fem !== undefined) score -= 0.08 * Math.abs(a.fem - e.fem);
  score += (hash01(e.id) - 0.5) * 0.04;
  return r3(Math.max(0, Math.min(1, score)));
}

function explain(a: Audience, e: SimEntity) {
  const raw = a.seeds.map((s) => ({ entity_id: s.id, name: s.name, score: Math.max(0, cos(s.v, e.v)) }));
  const total = raw.reduce((t, r) => t + r.score, 0) || 1;
  const out: Record<string, { entity_id?: string; name?: string; score: number }[]> = {
    "signal.interests.entities": raw.map((r) => ({ ...r, score: r3(r.score / total) })).sort((x, y) => y.score - x.score),
  };
  if (a.age !== undefined) {
    out["signal.demographics.age"] = [{ name: "age", score: r3(Math.max(0, 1 - Math.abs(a.age - e.age))) }];
  }
  return out;
}

function tagsFor(e: SimEntity) {
  const top = DIMS.filter((d) => (e.v[d] ?? 0) >= 0.5)
    .sort((x, y) => (e.v[y] ?? 0) - (e.v[x] ?? 0))
    .slice(0, 2);
  return TAGS.filter((t) => top.includes(t.dim))
    .slice(0, 4)
    .map((t) => ({ tag_id: t.id, id: t.id, name: t.name, subtype: t.subtype }));
}

function entityJson(e: SimEntity, query?: Record<string, unknown>) {
  const loc = e.type === "locality" ? e : e.city ? byId.get(e.city) : undefined;
  return {
    name: e.name,
    entity_id: e.id,
    type: "urn:entity",
    subtype: `urn:entity:${e.type}`,
    types: [`urn:entity:${e.type}`],
    popularity: e.pop,
    properties: {
      ...(e.priceLevel ? { price_level: e.priceLevel } : {}),
      ...(e.city ? { geocode: { name: byId.get(e.city)?.name } } : {}),
    },
    ...(loc?.lat !== undefined ? { location: { lat: loc.lat, lon: loc.lon } } : {}),
    tags: tagsFor(e),
    ...(query ? { query } : {}),
  };
}

const typeOf = (urn: string) => urn.replace("urn:entity:", "");

function matchesName(e: SimEntity, q: string) {
  const n = q.trim().toLowerCase();
  if (!n) return false;
  return [e.name, ...(e.aliases ?? [])].some((x) => {
    const xl = x.toLowerCase();
    return xl === n || (n.length >= 4 && xl.startsWith(n)) || (xl.length >= 5 && n.includes(xl));
  });
}

function placeInLocation(e: SimEntity, params: QlooParams) {
  const q = params["filter.location.query"];
  if (!q) return true;
  const loc = CATALOG.find((l) => l.type === "locality" && matchesName(l, String(q)));
  return !!loc && e.city === loc.id;
}

function insightsEntities(params: QlooParams) {
  const t = typeOf(String(params["filter.type"]));
  const a = audienceFrom(params);
  const only = list(params["filter.results.entities"]);
  const exclude = new Set([...list(params["filter.exclude.entities"]), ...a.seeds.map((s) => s.id)]);
  const take = Number(params.take ?? 20);
  const pmin = params["filter.price_level.min"] !== undefined ? Number(params["filter.price_level.min"]) : undefined;
  const pmax = params["filter.price_level.max"] !== undefined ? Number(params["filter.price_level.max"]) : undefined;
  const withExplain = params["feature.explainability"] === true || params["feature.explainability"] === "true";
  let pool = CATALOG.filter((e) => e.type === t);
  if (only.length) pool = pool.filter((e) => only.includes(e.id));
  else pool = pool.filter((e) => !exclude.has(e.id));
  if (t === "place") {
    pool = pool.filter((e) => placeInLocation(e, params));
    if (pmin !== undefined) pool = pool.filter((e) => (e.priceLevel ?? 0) >= pmin);
    if (pmax !== undefined) pool = pool.filter((e) => (e.priceLevel ?? 9) <= pmax);
  }
  const bias = params["bias.trends"];
  const scored = pool
    .map((e) => {
      let aff = affinity(a, e);
      if (bias === "high" || bias === "medium") aff = r3(Math.min(1, aff + e.trend * (bias === "high" ? 0.08 : 0.04)));
      return { e, aff };
    })
    .sort((x, y) => y.aff - x.aff)
    // diversify.by is never sent on entity types (see discoveryParams); urn:tag models it in tagInsights.
    .slice(0, only.length ? only.length : take);
  return {
    success: true,
    results: {
      entities: scored.map(({ e, aff }, i) =>
        entityJson(e, { affinity: aff, rank: i + 1, ...(withExplain ? { explainability: explain(a, e) } : {}) }),
      ),
    },
  };
}

/** As documented (demographics-use-case): one row per input signal, each with its own age and gender over-index. */
function demographics(params: QlooParams) {
  const a = audienceFrom(params);
  const row = (s: SimEntity) => {
    const age: Record<string, number> = {};
    AGE_BUCKETS.forEach((b, i) => {
      const p = i / (AGE_BUCKETS.length - 1);
      age[b] = r3(Math.max(-0.8, Math.min(0.8, (1 - 2.2 * Math.abs(p - s.age)) * 0.6)));
    });
    return { entity_id: s.id, query: { age, gender: { male: r3(-s.fem * 0.5), female: r3(s.fem * 0.5) } } };
  };
  return { success: true, results: { demographics: a.seeds.map(row) }, duration: 1 };
}

function tagInsights(params: QlooParams) {
  const a = audienceFrom(params);
  const take = Number(params.take ?? 12);
  const tags = TAGS.map((t) => ({
    tag_id: t.id,
    id: t.id,
    name: t.name,
    subtype: t.subtype,
    query: { affinity: affinity(a, { id: t.id, v: { [t.dim]: 1 } }) },
  }))
    .sort((x, y) => y.query.affinity - x.query.affinity);
  // diversify.by=subtype (documented for urn:tag): at most diversify.take per subtype, applied before take.
  const cap = params["diversify.by"] === "subtype" ? Number(params["diversify.take"] ?? Infinity) : Infinity;
  const perSubtype = new Map<string, number>();
  const kept = tags.filter((t) => {
    const n = perSubtype.get(t.subtype) ?? 0;
    perSubtype.set(t.subtype, n + 1);
    return n < cap;
  });
  return { success: true, results: { tags: kept.slice(0, take) } };
}

/** Bounding box of a WKT POLYGON (lon lat pairs), or undefined. */
export function wktBBox(wkt: string): { minLon: number; maxLon: number; minLat: number; maxLat: number } | undefined {
  const body = /^POLYGON\s*\(\((.+)\)\)$/i.exec(wkt)?.[1];
  if (!body) return undefined;
  const pts: [number, number][] = [];
  for (const p of body.split(",")) {
    const [lon, lat, ...rest] = p.trim().split(/\s+/).map(Number);
    if (lon === undefined || lat === undefined || rest.length || !Number.isFinite(lon) || !Number.isFinite(lat)) return undefined;
    pts.push([lon, lat]);
  }
  const lons = pts.map((p) => p[0]);
  const lats = pts.map((p) => p[1]);
  return { minLon: Math.min(...lons), maxLon: Math.max(...lons), minLat: Math.min(...lats), maxLat: Math.max(...lats) };
}

/** Documented `take`: default 20, max 50. */
const heatTake = (params: QlooParams) => Math.min(50, Math.max(1, Number(params.take ?? 20)));

const CELL_OFFSETS: [number, number][] = [[0, 0], [0.25, 0.1], [-0.2, 0.2], [0.15, -0.25], [-0.3, -0.1], [0.05, 0.35]];

function heatmap(params: QlooParams) {
  const a = audienceFrom(params);
  // A city's scene is what's being compared, so the age term is left out.
  const ageless = { ...a, age: undefined, fem: undefined };
  const box = typeof params["filter.location"] === "string" ? wktBBox(params["filter.location"]) : undefined;
  const inCity = typeof params["filter.location.query"] === "string" ? CATALOG.find((e) => e.type === "locality" && e.name === params["filter.location.query"]) : undefined;
  if (inCity?.lat !== undefined && inCity.lon !== undefined) {
    // One city: a neighbourhood-scale grid of cells around its centre.
    const { lat, lon } = inCity;
    const base = affinity(ageless, inCity);
    const grid = [-2, -1, 0, 1, 2].flatMap((i) => [-2, -1, 0, 1, 2].map((j) => ({ i, j })));
    const cells = grid
      .map(({ i, j }, k) => ({
        location: { latitude: r3(lat + i * 0.04), longitude: r3(lon + j * 0.05), geohash: `simc${k}` },
        query: { affinity: r3(Math.max(0, Math.min(1, base + (hash01(`${inCity.id}:n${k}`) - 0.5) * 0.3 - (Math.abs(i) + Math.abs(j)) * 0.03))), popularity: inCity.pop },
      }))
      .sort((x, y) => y.query.affinity - x.query.affinity)
      .slice(0, heatTake(params));
    return { success: true, results: { heatmap: cells } };
  }
  // Unnamed geohash-sized cells, several per metro, strongest first; `take` caps them (docs: default 20, max 50).
  const cells = CATALOG.filter((e) => e.type === "locality").flatMap((l) => {
    const { lat, lon } = l;
    if (lat === undefined || lon === undefined) return [];
    const base = affinity(ageless, l);
    return CELL_OFFSETS.map(([dLat, dLon], i) => ({
      lat: r3(lat + dLat),
      lon: r3(lon + dLon),
      affinity: r3(Math.max(0, Math.min(1, base + (hash01(`${l.id}:${i}`) - 0.5) * 0.08))),
      pop: l.pop,
    }));
  });
  const inBox = (box ? cells.filter((c) => c.lon >= box.minLon && c.lon <= box.maxLon && c.lat >= box.minLat && c.lat <= box.maxLat) : cells)
    .sort((x, y) => y.affinity - x.affinity)
    .slice(0, heatTake(params));
  return {
    success: true,
    results: {
      heatmap: inBox.map((c, i) => ({
        location: { latitude: c.lat, longitude: c.lon, geohash: `sim${i}` },
        query: { affinity: c.affinity, popularity: c.pop },
      })),
    },
  };
}

const DAY = 86_400_000;

/**
 * As documented (get-trending): one entity's weekly series between
 * filter.start_date and filter.end_date, newest first, under results.trending.
 * The catalog's trend (-1 fading … +1 rising) sets the newest
 * population_percent_delta (×10, in percent), with earlier weeks easing toward it.
 */
function trending(params: QlooParams) {
  const t = typeOf(String(params["filter.type"]));
  const [id] = list(params["signal.interests.entities"]);
  const e = id ? byId.get(id) : undefined;
  const start = Date.parse(`${String(params["filter.start_date"])}T00:00:00Z`);
  const end = Date.parse(`${String(params["filter.end_date"])}T00:00:00Z`);
  if (!e || e.type !== t || !Number.isFinite(start) || !Number.isFinite(end) || end < start) return { success: true, results: { trending: [] }, duration: 1 };
  const weeks = Math.min(52, Math.floor((end - start) / (7 * DAY)) + 1);
  const trend = Array.from({ length: weeks }, (_, w) => {
    const ease = 1 - w / (weeks + 1);
    const delta = r3(e.trend * 10 * ease);
    const percentile = r3(Math.max(0, Math.min(100, e.pop * 100 - w * e.trend)));
    const rank = Math.max(1, Math.round((1 - percentile / 100) * 5000));
    return {
      date: new Date(end - w * 7 * DAY).toISOString().slice(0, 10),
      population_percentile: percentile,
      population_rank: rank,
      population_rank_velocity: Math.round(e.trend * 40 * ease),
      velocity_fold_change: r3(1 + e.trend * 0.2 * ease),
      population_percent_delta: delta,
    };
  });
  return { success: true, results: { trending: trend }, duration: 1 };
}

/**
 * As documented (analysis-compare): `results` is an array. With
 * filter.subtype=urn:tag:genre the items are genre tags; the per-side
 * affinities under `query.a` / `query.b` are this repo's reading, since the
 * docs publish no example (see BLOCKED.md).
 */
function compare(params: QlooParams) {
  const a = audienceFrom(params, "a.signal");
  const b = audienceFrom(params, "b.signal");
  const take = Number(params.take ?? 20);
  const sub = params["filter.subtype"];
  const results = TAGS.filter((t) => sub === undefined || t.subtype === String(sub) || t.subtype.startsWith(`${String(sub)}:`))
    .map((t) => {
      const va = affinity(a, { id: t.id, v: { [t.dim]: 1 } });
      const vb = affinity(b, { id: t.id, v: { [t.dim]: 1 } });
      return { name: t.name, entity_id: t.id, tag_id: t.id, type: "urn:tag", subtype: t.subtype, query: { a: { affinity: va }, b: { affinity: vb }, delta: r3(va - vb) } };
    })
    .sort((x, y) => Math.abs(y.query.delta) - Math.abs(x.query.delta))
    .slice(0, take);
  return { success: true, duration: 0.1, results };
}

function search(params: QlooParams) {
  const q = String(params.query ?? "");
  const types = list(params.types).map(typeOf);
  const take = Number(params.take ?? 5);
  const results = CATALOG.filter((e) => (!types.length || types.includes(e.type)) && matchesName(e, q))
    .sort((x, y) => (x.name.toLowerCase() === q.toLowerCase() ? -1 : 0) - (y.name.toLowerCase() === q.toLowerCase() ? -1 : 0) || y.pop - x.pop)
    .slice(0, take)
    .map((e) => entityJson(e));
  return { results };
}

function entities(params: QlooParams) {
  const ids = list(params.entity_ids);
  const spotify = new Set(list(params["external.spotify.ids"]));
  const imdb = new Set(list(params["external.imdb.ids"]));
  const external = CATALOG.filter((e) => (e.external?.spotify && spotify.has(e.external.spotify)) || (e.external?.imdb && imdb.has(e.external.imdb)));
  const found = [...ids.map((id) => byId.get(id)).filter((e): e is SimEntity => !!e), ...external];
  return { results: found.map((e) => entityJson(e)) };
}

function tags(params: QlooParams) {
  const q = String(params["filter.query"] ?? "").toLowerCase();
  const words = q.split(/\W+/).filter((w) => w.length > 2);
  const results = TAGS.filter((t) => words.some((w) => t.name.includes(w) || t.dim.includes(w))).map((t) => ({
    id: t.id,
    tag_id: t.id,
    name: t.name,
    subtype: t.subtype,
  }));
  return { success: true, results: { tags: results.slice(0, Number(params.take ?? 10)) } };
}

export function simulate(path: QlooPath, params: QlooParams): unknown {
  switch (path) {
    case "/search":
      return search(params);
    case "/entities":
      return entities(params);
    case "/v2/tags":
      return tags(params);
    case "/v2/trending":
      return trending(params);
    case "/v2/analysis/compare":
      return compare(params);
    case "/v2/insights": {
      const t = String(params["filter.type"]);
      if (t === "urn:demographics") return demographics(params);
      if (t === "urn:tag") return tagInsights(params);
      if (t === "urn:heatmap") return heatmap(params);
      return insightsEntities(params);
    }
  }
}
