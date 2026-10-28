/**
 * Contract tests: the response schemas parse the payloads Qloo's docs publish,
 * and the offline simulator answers in those same documented shapes.
 *
 * Sources (fetched 2026-10-25):
 * - get-trending: OpenAPI schema examples (https://docs.qloo.com/reference/get-trending)
 * - analysis-compare: OpenAPI schema, `results` is an array of entity-shaped items; no example published
 * - heatmaps-use-case: the example response (first two cells)
 * - demographics-use-case: one row per input signal (a tag and an entity)
 */
import { describe, expect, it } from "vitest";
import { fc, test } from "@fast-check/vitest";
import { foldHeatmap } from "@/lib/agent/cities";
import { simulate } from "@/lib/qloo/sim/simulator";
import { CompareResponse, InsightsResponse, SearchResponse, TrendingResponse, compareItems, explainabilityOf, latestTrend, type TrendPoint } from "@/lib/qloo/types";
import { must } from "../must";

const TRENDING_DOC = {
  success: true,
  duration: 123,
  results: {
    trending: [
      { date: "2025-01-03", population_percentile: 85.2, population_rank: 150, population_rank_velocity: 5, velocity_fold_change: 1.15, population_percent_delta: 1.15 },
    ],
  },
};

/** Documented shape (Common.yml entity fields); the docs publish no example values for compare. */
const COMPARE_DOC = {
  success: true,
  duration: 0.1,
  results: [
    { name: "Afrobeats", entity_id: "urn:tag:genre:music:afrobeats", type: "urn:tag", subtype: "urn:tag:genre:music" },
    { name: "Hip-Hop", entity_id: "urn:tag:genre:music:hip_hop", type: "urn:tag", subtype: "urn:tag:genre:music" },
  ],
};

const HEATMAP_DOC = {
  success: true,
  results: {
    heatmap: [
      { location: { latitude: 40.591736, longitude: -73.756714, geohash: "dr5wct" }, query: { affinity: 1, affinity_rank: 0.9976498237367802, popularity: 0.9717472118959107 } },
      { location: { latitude: 40.74005, longitude: -73.87756, geohash: "dr5ryb" }, query: { affinity: 0.9992565055762082, affinity_rank: 0.9960474308300395, popularity: 0.5449814126394052 } },
    ],
  },
  query: {
    localities: {
      filter: {
        entity_id: "81E61924-6CEE-4AB4-93D3-282A5C784AB8",
        name: "New York",
        subtype: "urn:entity:locality",
        location: { lat: -73.93889084762313, lng: 40.66320611815103 },
        popularity: 1,
        disambiguation: "New York, New York, United States of America",
      },
    },
  },
  duration: 75,
};

const ages = { "24_and_younger": 0.1, "25_to_29": 0.2, "30_to_34": 0.05, "35_to_44": -0.1, "45_to_54": -0.2, "55_and_older": -0.3 };
const DEMOGRAPHICS_DOC = {
  success: true,
  results: {
    demographics: [
      { entity_id: "urn:tag:genre:media:action", query: { age: ages, gender: { male: 0.2, female: -0.2 } } },
      { entity_id: "B8BEE72B-B321-481F-B81A-A44881D094D6", query: { age: ages, gender: { male: -0.1, female: 0.1 } } },
    ],
  },
  duration: 12,
};

describe("documented payloads parse", () => {
  it("/v2/trending: results.trending[] date series with integer rank fields", () => {
    const r = TrendingResponse.parse(TRENDING_DOC);
    expect(r.results.trending).toHaveLength(1);
    expect(latestTrend(r.results.trending)?.population_percent_delta).toBe(1.15);
  });
  it("/v2/trending: a non-integer population_rank_velocity is rejected (the docs type it integer)", () => {
    const bad = structuredClone(TRENDING_DOC);
    const [point] = bad.results.trending;
    must(point).population_rank_velocity = 0.5;
    expect(TrendingResponse.safeParse(bad).success).toBe(false);
  });
  it("/v2/analysis/compare: `results` is an array (documented), and the older results.tags form still parses", () => {
    const r = CompareResponse.parse(COMPARE_DOC);
    expect(compareItems(r).map((t) => t.name)).toEqual(["Afrobeats", "Hip-Hop"]);
    const legacy = CompareResponse.parse({ results: { tags: [{ name: "x", query: { a: { affinity: 0.4 }, b: { affinity: 0.1 }, delta: 0.3 } }] } });
    expect(compareItems(legacy)[0]?.query?.delta).toBe(0.3);
    expect(compareItems(CompareResponse.parse({}))).toEqual([]);
  });
  it("urn:heatmap: the heatmaps-use-case example", () => {
    const r = InsightsResponse.parse(HEATMAP_DOC);
    expect(r.results.heatmap?.[0]?.location.geohash).toBe("dr5wct");
    expect(r.results.heatmap?.[1]?.query.affinity).toBeCloseTo(0.99925, 4);
  });
  it("a locality's location reads from `lon` or the heatmaps use-case's `lng`, and swapped values are put back", () => {
    const loc = (location: unknown) => SearchResponse.parse({ results: [{ name: "New York", entity_id: "x", location }] }).results[0]?.location;
    // The doc's New York: { lat: -73.9, lng: 40.7 }, a US point written backwards.
    expect(loc(HEATMAP_DOC.query.localities.filter.location)).toMatchObject({ lat: 40.66320611815103, lon: -73.93889084762313 });
    // Real southern-hemisphere points stay as sent (Sydney, Johannesburg, São Paulo).
    expect(loc({ lat: -33.87, lon: 151.21 })).toMatchObject({ lat: -33.87, lon: 151.21 });
    expect(loc({ lat: -26.2, lon: 28.05 })).toMatchObject({ lat: -26.2, lon: 28.05 });
    expect(loc({ lat: -23.55, lon: -46.63 })).toMatchObject({ lat: -23.55, lon: -46.63 });
    expect(loc({ lat: 40.7, lon: -74 })).toMatchObject({ lat: 40.7, lon: -74 });
    expect(loc({ lat: 40.7, lng: -74 })).toMatchObject({ lat: 40.7, lon: -74 });
    expect(loc({ lat: -118.2, lng: 34.05 })).toMatchObject({ lat: 34.05, lon: -118.2 });
    expect(loc({ lat: 33.7, lon: 84.4 })).toMatchObject({ lat: 33.7, lon: 84.4 });
    expect(loc(null)).toBeUndefined();
  });
  it("the doc's New York, swapped as published, still folds onto the doc's own New York heatmap cells", () => {
    const at = must(SearchResponse.parse({ results: [{ name: "New York", entity_id: "x", location: HEATMAP_DOC.query.localities.filter.location }] }).results[0]?.location);
    const cells = HEATMAP_DOC.results.heatmap.map((c) => ({ lat: c.location.latitude, lon: c.location.longitude, affinity: c.query.affinity }));
    expect(foldHeatmap([{ name: "New York", lat: at.lat, lon: at.lon, affinity: 0 }], cells)).toHaveLength(1);
  });
  it("urn:demographics: one row per input signal", () => {
    const r = InsightsResponse.parse(DEMOGRAPHICS_DOC);
    expect(r.results.demographics).toHaveLength(2);
  });
  it("explainability that couldn't be computed: a string at query.explainability.warning (insights-api-deep-dive) parses, with no drivers", () => {
    const reply = { results: { entities: [{ entity_id: "e1", name: "N", query: { affinity: 0.7, explainability: { warning: "Explainability could not be computed for this request" } } }] } };
    const r = InsightsResponse.safeParse(reply);
    expect(r.success).toBe(true);
    const q = must(r.data?.results.entities?.[0]?.query);
    expect(q.affinity).toBe(0.7);
    expect(explainabilityOf(q.explainability)).toEqual({ drivers: [], warning: "Explainability could not be computed for this request" });
  });
  it("affinity: null parses (read as unscored, never as 0), on entities, tags, heatmap cells and compare sides", () => {
    expect(InsightsResponse.safeParse({ results: { entities: [{ entity_id: "e1", name: "N", query: { affinity: null, rank: null } }] } }).success).toBe(true);
    expect(InsightsResponse.safeParse({ results: { tags: [{ name: "t", query: { affinity: null } }] } }).success).toBe(true);
    expect(InsightsResponse.safeParse({ results: { heatmap: [{ location: { latitude: 1, longitude: 2 }, query: { affinity: null } }] } }).success).toBe(true);
    expect(CompareResponse.safeParse({ results: [{ name: "x", query: { a: { affinity: null }, b: null } }] }).success).toBe(true);
  });
});

describe("explainabilityOf", () => {
  it("reads the entity drivers and drops malformed ones one by one", () => {
    const ex = { "signal.interests.entities": [{ entity_id: "a", score: 0.6 }, { entity_id: "b", score: "high" }, null, { name: "C", score: 0.2 }] };
    expect(explainabilityOf(ex).drivers).toEqual([{ entity_id: "a", score: 0.6 }, { name: "C", score: 0.2 }]);
  });
  test.prop([fc.jsonValue()])("never throws on any JSON, and returns a warning only as a non-empty string with no drivers beside it", (raw) => {
    const r = explainabilityOf(raw);
    if (r.warning !== undefined) {
      expect(r.warning.length).toBeGreaterThan(0);
      expect(r.drivers).toEqual([]);
    }
    for (const d of r.drivers) expect(typeof d.score).toBe("number");
  });
});

describe("the simulator answers in the documented shapes", () => {
  const trend = (id: string, type: string) =>
    simulate("/v2/trending", { "filter.type": type, "signal.interests.entities": id, "filter.start_date": "2026-09-07", "filter.end_date": "2026-10-19" });

  it("/v2/trending: a weekly series under results.trending, newest first, inside the window", () => {
    const r = TrendingResponse.parse(trend("sim-movie-black-panther", "urn:entity:movie"));
    const dates = r.results.trending.map((p) => p.date);
    expect(dates.length).toBe(7);
    expect(dates[0]).toBe("2026-10-19");
    expect([...dates].sort().reverse()).toEqual(dates);
    for (const d of dates) expect(d >= "2026-09-07" && d <= "2026-10-19").toBe(true);
    for (const p of r.results.trending) expect(Number.isInteger(p.population_rank_velocity)).toBe(true);
    expect(JSON.stringify(r)).not.toMatch(/entity_id/);
  });
  it("/v2/trending: an unknown entity, a type mismatch or a bad window is an empty series, not an error", () => {
    expect(TrendingResponse.parse(trend("nope", "urn:entity:movie")).results.trending).toEqual([]);
    expect(TrendingResponse.parse(trend("sim-movie-black-panther", "urn:entity:artist")).results.trending).toEqual([]);
  });
  it("/v2/analysis/compare: `results` is an array", () => {
    const raw = simulate("/v2/analysis/compare", { "a.signal.interests.entities": "sim-artist-tems", "b.signal.interests.entities": "sim-artist-burna-boy", "filter.subtype": "urn:tag:genre", take: 5 }) as { results: unknown };
    expect(Array.isArray(raw.results)).toBe(true);
    const items = compareItems(CompareResponse.parse(raw));
    expect(items.length).toBeGreaterThan(0);
    expect(items.length).toBeLessThanOrEqual(5);
    for (const t of items) expect(t.subtype).toMatch(/^urn:tag:genre/);
  });
  it("urn:demographics: one row per seed", () => {
    const r = InsightsResponse.parse(simulate("/v2/insights", { "filter.type": "urn:demographics", "signal.interests.entities": "sim-artist-tems,sim-artist-rema" }));
    expect(r.results.demographics?.map((d) => d.entity_id)).toEqual(["sim-artist-tems", "sim-artist-rema"]);
  });
  it("urn:heatmap honours the documented take (default 20, max 50), strongest cells first", () => {
    const cells = (take?: number) => InsightsResponse.parse(simulate("/v2/insights", { "filter.type": "urn:heatmap", "signal.interests.entities": "sim-artist-tems", ...(take ? { take } : {}) })).results.heatmap ?? [];
    expect(cells()).toHaveLength(20);
    expect(cells(50)).toHaveLength(50);
    const affs = cells(50).map((c) => must(c.query.affinity));
    expect([...affs].sort((a, b) => b - a)).toEqual(affs);
  });
});

describe("latestTrend", () => {
  const point = fc.record({
    date: fc.integer({ min: Date.UTC(2020, 0, 1), max: Date.UTC(2030, 0, 1) }).map((t) => new Date(t).toISOString().slice(0, 10)),
    population_percent_delta: fc.option(fc.double({ min: -100, max: 100, noNaN: true }), { nil: undefined }),
  });
  test.prop([fc.array(point, { maxLength: 20 })])("picks the newest point with a delta, whatever the order", (pts: TrendPoint[]) => {
    const got = latestTrend(pts);
    const withDelta = pts.filter((p) => typeof p.population_percent_delta === "number");
    if (!withDelta.length) expect(got).toBeUndefined();
    else {
      const newest = withDelta.map((p) => p.date).sort().at(-1);
      expect(got?.date).toBe(newest);
    }
  });
});
