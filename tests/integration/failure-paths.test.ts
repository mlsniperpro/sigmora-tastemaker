/** Failure paths and Qloo call-shape rules from the API-contract review: each one used to sink a run or show a wrong number. */
import { describe, expect, it, vi } from "vitest";
import { fc, test } from "@fast-check/vitest";
import { rankCities } from "@/lib/agent/cities";
import { TREND_POOL_TOP, aggregateDemographics, loadCulture, loadTrends, loadVenues, makeCtx, trendItems, trendWindow, type Audience, type RankedCandidate } from "@/lib/agent/context";
import { PRESETS } from "@/lib/agent/presets";
import { runTastemaker } from "@/lib/agent/run";
import { DeterministicLLM } from "@/lib/llm/deterministic";
import type { Choice, DraftInput, Replacement } from "@/lib/llm/types";
import { QlooBudgetError } from "@/lib/qloo/errors";
import { MemoryCache, type CacheStore } from "@/lib/qloo/cache";
import { EMPTY_TTL, QlooClient, isEmptyReply, trendFamily } from "@/lib/qloo/client";
import { requestKey } from "@/lib/qloo/params";
import { must } from "../must";

const audience: Audience = { ages: ["25_to_29", "30_to_34"] };
const offline = () => new QlooClient({ cache: new MemoryCache(), fixtures: {} });
const ctxOf = (q: QlooClient = offline()) => makeCtx(audience, q, [{ name: "Tems", entityId: "sim-artist-tems" }]);
const cand = (name: string, type: RankedCandidate["type"], affinity = 0.5): RankedCandidate => ({ name, type, affinity, entityId: `id-${name}` });

describe("trendWindow", () => {
  it("ends on the most recent Monday (UTC) and spans six weeks", () => {
    expect(trendWindow(new Date("2026-10-25T08:00:00Z"))).toEqual({ start: "2026-09-07", end: "2026-10-19" });
    expect(trendWindow(new Date("2026-10-19T00:00:00Z"))).toEqual({ start: "2026-09-07", end: "2026-10-19" });
  });
  test.prop([fc.integer({ min: Date.UTC(2024, 0, 1), max: Date.UTC(2030, 0, 1) }), fc.integer({ min: 1, max: 26 })])("is YYYY-MM-DD, Monday-anchored, within the last week, and exactly `weeks` long", (t, weeks) => {
    const w = trendWindow(new Date(t), weeks);
    expect(w.start).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const end = Date.parse(`${w.end}T00:00:00Z`);
    const start = Date.parse(`${w.start}T00:00:00Z`);
    expect(new Date(end).getUTCDay()).toBe(1);
    expect(t - end).toBeGreaterThanOrEqual(0);
    expect(t - end).toBeLessThan(7 * 86_400_000);
    expect(end - start).toBe(weeks * 7 * 86_400_000);
  });
});

describe("loadTrends", () => {
  it("calls /v2/trending once per entity, only for fading-checked roles, never twice for the same entity", async () => {
    const ctx = ctxOf();
    const spy = vi.spyOn(ctx.qloo, "trending");
    const items = [
      { entityId: "sim-movie-black-panther", type: "movie", role: "reference" as const },
      { entityId: "sim-tv_show-insecure", type: "tv_show", role: "reference" as const },
      { entityId: "sim-movie-black-panther", type: "movie", role: "reference" as const },
      { entityId: "sim-artist-rema", type: "artist", role: "collab" as const },
    ];
    expect(await loadTrends(ctx, items)).toEqual([]);
    expect(spy).toHaveBeenCalledTimes(2);
    for (const [, id, w] of spy.mock.calls) {
      expect(typeof id).toBe("string");
      expect(w.start < w.end).toBe(true);
    }
    expect(ctx.trends.has("sim-artist-rema")).toBe(false);
    // Black Panther is set to fade in the catalog: its newest percent delta is below the bar.
    expect(must(ctx.trends.get("sim-movie-black-panther"))).toBeLessThan(ctx.fadingBelow);
    await loadTrends(ctx, items);
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it("remembers an entity Qloo has no series for (no reading, not fading, not re-asked)", async () => {
    const ctx = ctxOf();
    const spy = vi.spyOn(ctx.qloo, "trending");
    await loadTrends(ctx, [{ entityId: "unknown-id", type: "movie", role: "reference" }]);
    await loadTrends(ctx, [{ entityId: "unknown-id", type: "movie", role: "reference" }]);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(ctx.trends.has("unknown-id")).toBe(true);
    expect(ctx.trends.get("unknown-id")).toBeUndefined();
  });

  it("returns failures (grouped by reason) instead of throwing", async () => {
    const ctx = ctxOf();
    vi.spyOn(ctx.qloo, "trending").mockRejectedValue(new Error("Qloo 500 on /v2/trending"));
    const failures = await loadTrends(ctx, [
      { entityId: "a", type: "movie", role: "reference" },
      { entityId: "b", type: "tv_show", role: "reference" },
    ]);
    expect(failures).toEqual(["Qloo 500 on /v2/trending (×2)"]);
    expect(ctx.trends.size).toBe(0);
  });

  it("checks at most TREND_POOL_TOP candidates per fading-checked role", () => {
    const ctx = ctxOf();
    ctx.candidates = {
      reference: Array.from({ length: 20 }, (_, i) => cand(`r${i}`, i % 2 ? "movie" : "tv_show")),
      collab: [cand("c", "artist")],
    };
    const items = trendItems(ctx);
    expect(items).toHaveLength(TREND_POOL_TOP);
    expect(items.every((i) => i.role === "reference")).toBe(true);
  });
});

describe("aggregateDemographics", () => {
  it("averages every row (one per seed), not just the first", () => {
    const agg = aggregateDemographics([
      { query: { age: { "25_to_29": 0.4, "35_to_44": -0.2 }, gender: { female: 0.2, male: -0.2 } } },
      { query: { age: { "25_to_29": 0.0, "35_to_44": 0.2 }, gender: { female: 0.0, male: 0.0 } } },
    ]);
    expect(agg.age).toEqual([
      { bucket: "25_to_29", value: 0.2 },
      { bucket: "35_to_44", value: 0 },
    ]);
    expect(agg.gender).toEqual([
      { bucket: "female", value: 0.1 },
      { bucket: "male", value: -0.1 },
    ]);
    expect(aggregateDemographics([])).toEqual({ age: [], gender: [] });
  });
  const row = fc.record({ query: fc.record({ age: fc.dictionary(fc.constantFrom("24_and_younger", "25_to_29", "55_and_older"), fc.double({ min: -1, max: 1, noNaN: true })) }) });
  test.prop([fc.array(row, { minLength: 1, maxLength: 6 })])("each bucket's value lies between that bucket's smallest and largest row value", (rows) => {
    for (const { bucket, value } of aggregateDemographics(rows).age) {
      const vs = rows.flatMap((r) => (bucket in r.query.age ? [must(r.query.age[bucket])] : []));
      expect(value).toBeGreaterThanOrEqual(Math.min(...vs) - 1e-9);
      expect(value).toBeLessThanOrEqual(Math.max(...vs) + 1e-9);
    }
  });
});

describe("rankCities", () => {
  it("keeps the heatmap fallback when the locality ranking call fails", async () => {
    const q = offline();
    const real = q.insights.bind(q);
    vi.spyOn(q, "insights").mockImplementation((t, p) => (t === "urn:entity:locality" ? Promise.reject(new Error("Qloo 500 on /v2/insights")) : real(t, p)));
    const r = await rankCities(ctxOf(q), ["Atlanta", "Houston", "Washington, DC"]);
    expect(r.localityError).toMatch(/500/);
    expect(r.rankedBy).toBe("heatmap");
    expect(r.cities.length).toBeGreaterThan(0);
    expect(r.heatmap.length).toBeGreaterThan(0);
  });
});

describe("loadCulture", () => {
  it("reports a failed type and still loads the others", async () => {
    const q = offline();
    const real = q.insights.bind(q);
    vi.spyOn(q, "insights").mockImplementation((t, p) => (t === "urn:entity:tv_show" ? Promise.reject(new Error("Qloo 502 on /v2/insights")) : real(t, p)));
    const ctx = ctxOf(q);
    const { lists, failures } = await loadCulture(ctx);
    expect(failures).toEqual(["tv_show: Qloo 502 on /v2/insights"]);
    expect(lists.map(([t]) => t)).not.toContain("tv_show");
    expect((ctx.candidates.reference ?? []).every((c) => c.type === "movie")).toBe(true);
    expect(ctx.candidates.collab?.length).toBeGreaterThan(0);
  });
  it("throws only when every type failed", async () => {
    const q = offline();
    vi.spyOn(q, "insights").mockRejectedValue(new Error("Qloo 503"));
    await expect(loadCulture(ctxOf(q))).rejects.toThrow(/503/);
  });
});

describe("loadVenues", () => {
  it("drops the previous city's pool before loading, so a failed load leaves none rather than a stale one", async () => {
    const ctx = ctxOf();
    await loadVenues(ctx, "Washington, DC");
    expect(ctx.candidates.venue?.length).toBeGreaterThan(0);
    vi.spyOn(ctx.qloo, "insights").mockRejectedValue(new Error("Qloo 500"));
    await expect(loadVenues(ctx, "Houston")).rejects.toThrow(/500/);
    expect(ctx.candidates.venue).toBeUndefined();
  });
});

describe("runTastemaker failure paths", () => {
  it("keeps the grounded plan when the baseline audit fails, and marks the comparison unavailable with the reason", async () => {
    const q = offline();
    const real = q.search.bind(q);
    // The baseline's invented podcast is only ever searched in the audit.
    vi.spyOn(q, "search").mockImplementation((query, types, take) => (query === "Afrowave Weekly" ? Promise.reject(new Error("Qloo 500 on /search")) : real(query, types, take)));
    const r = await runTastemaker(must(PRESETS[0]).brief, { qloo: q, llm: new DeterministicLLM() });
    expect(r.grounded.receipts.length).toBeGreaterThan(0);
    expect(r.trace.find((s) => s.id === "audit")).toMatchObject({ status: "error" });
    expect(r.baseline.unavailable).toMatch(/audit.*500/);
    expect(r.metrics.baseline.cultureMissRate).toBeNull();
  });

  it("shows a failed culture type on the trace and carries on", async () => {
    const q = offline();
    const real = q.insights.bind(q);
    vi.spyOn(q, "insights").mockImplementation((t, p) => (t === "urn:entity:podcast" && !p["filter.results.entities"] ? Promise.reject(new Error("Qloo 500 on /v2/insights")) : real(t, p)));
    const r = await runTastemaker(must(PRESETS[0]).brief, { qloo: q, llm: new DeterministicLLM() });
    const culture = must(r.trace.find((s) => s.id === "culture"));
    expect(culture.status).toBe("done");
    expect(culture.detail).toMatch(/failed: podcast: Qloo 500/);
    expect(r.grounded.receipts.length).toBeGreaterThan(0);
  });

  it("leaves the model's own idea unchecked, and keeps Qloo's option, when Qloo fails on it (the choose step is required)", async () => {
    class Inventive extends DeterministicLLM {
      override async choose(reps: Replacement[]): Promise<Choice[]> {
        return reps.map((r, i) => ({ from: r.from, to: i === 0 ? "Zzq Own Brand" : r.to, why: "my own idea", own: i === 0 }));
      }
    }
    const q = offline();
    const real = q.search.bind(q);
    vi.spyOn(q, "search").mockImplementation((query, types, take) => (query === "Zzq Own Brand" ? Promise.reject(new Error("Qloo 500 on /search")) : real(query, types, take)));
    const r = await runTastemaker(must(PRESETS[0]).brief, { qloo: q, llm: new Inventive() });
    const step = must(r.trace.find((s) => s.id === "choose-1"));
    expect(step.status).toBe("done");
    expect(step.detail).toMatch(/the model's own idea "Zzq Own Brand" wasn't checked/);
    expect(step.detail).toMatch(/own ideas weren't checked \(Qloo 500 on \/search\)/);
    expect(r.grounded.receipts.some((x) => x.name === "Zzq Own Brand")).toBe(false);
  });

  it("marks a venue unscored, with the reason, when Qloo's location filter fails for the city (400: no locality found)", async () => {
    const q = offline();
    const real = q.insights.bind(q);
    const inCityCalls: string[] = [];
    vi.spyOn(q, "insights").mockImplementation((t, p) => {
      if (t === "urn:entity:place" && p["filter.results.entities"] && p["filter.location.query"]) {
        inCityCalls.push(`${String(p["filter.location.query"])}|${String(p["filter.results.entities"])}`);
        return Promise.reject(new Error("Qloo 400 on /v2/insights: no locality found for filter.location.query"));
      }
      return real(t, p);
    });
    const r = await runTastemaker(must(PRESETS[0]).brief, { qloo: q, llm: new DeterministicLLM() });
    const venue = must(r.grounded.receipts.find((x) => x.role === "venue"));
    expect(venue.verdict).toBe("unscored");
    expect(venue.note).toMatch(/couldn't check that it's in .*location filter failed: Qloo 400/);
    // Everything else is still judged, and a failed check is never re-sent for the same city and venue.
    expect(r.grounded.receipts.filter((x) => x.role !== "venue").every((x) => x.verdict !== "unscored")).toBe(true);
    expect(new Set(inCityCalls).size).toBe(inCityCalls.length);
    expect(r.trace.find((s) => s.id === "critic-1")?.status).toBe("done");
  });

  it("records a failed search for a name in the copy and carries on", async () => {
    class Sneaky extends DeterministicLLM {
      override async draft(input: DraftInput) {
        const d = await super.draft(input);
        return { ...d, script: `${d.script} Cameo: Burna Boy.` };
      }
    }
    const q = offline();
    const real = q.search.bind(q);
    vi.spyOn(q, "search").mockImplementation((query, types, take) => (query === "Burna Boy" ? Promise.reject(new Error("Qloo 502 on /search")) : real(query, types, take)));
    const r = await runTastemaker(must(PRESETS[0]).brief, { qloo: q, llm: new Sneaky() });
    const critic = must(r.trace.find((s) => s.id === "critic-1"));
    expect(critic.status).toBe("done");
    expect(critic.detail).toMatch(/copy names not checked \(Qloo 502 on \/search\): Burna Boy/);
    expect(r.grounded.receipts.some((x) => x.name === "Burna Boy")).toBe(false);
  });

  it("says the compare reply's shape wasn't recognised, rather than 'no gap found', when no item is scored on both sides", async () => {
    const q = offline();
    vi.spyOn(q, "compare").mockResolvedValue({
      data: { results: [{ name: "Afrobeats", entity_id: "urn:tag:genre:music:afrobeats" }, { name: "Hip-Hop", query: { a: { affinity: 0.4 } } }] },
      meta: { path: "/v2/analysis/compare", params: {}, key: "compare-key", source: "live", cached: false, latencyMs: 1 },
    });
    const r = await runTastemaker(must(PRESETS[0]).brief, { qloo: q, llm: new DeterministicLLM() });
    const step = must(r.trace.find((s) => s.id === "compare"));
    expect(step.detail).toMatch(/compare reply shape not recognised: 2 items/);
    expect(step.detail).not.toMatch(/no gap found/);
    expect(r.positioning).toEqual([]);
  });

  it("runs the baseline audit before critic pass 2, so a tight Qloo budget still judges what it can of the baseline", async () => {
    /** Offline, but every call counts against a cap, as a live run's budget does. */
    class Capped extends QlooClient {
      calls = 0;
      constructor(readonly cap: number) {
        super({ cache: new MemoryCache(), fixtures: {} });
      }
      /** A rejection once the cap is spent; undefined while the call may go ahead. */
      private refuse(): Promise<never> | undefined {
        return ++this.calls > this.cap ? Promise.reject(new QlooBudgetError("run", this.cap)) : undefined;
      }
      override search(...a: Parameters<QlooClient["search"]>) {
        return this.refuse() ?? super.search(...a);
      }
      override entitiesByExternal(...a: Parameters<QlooClient["entitiesByExternal"]>) {
        return this.refuse() ?? super.entitiesByExternal(...a);
      }
      override insights(...a: Parameters<QlooClient["insights"]>) {
        return this.refuse() ?? super.insights(...a);
      }
      override trending(...a: Parameters<QlooClient["trending"]>) {
        return this.refuse() ?? super.trending(...a);
      }
      override compare(...a: Parameters<QlooClient["compare"]>) {
        return this.refuse() ?? super.compare(...a);
      }
      override tags(...a: Parameters<QlooClient["tags"]>) {
        return this.refuse() ?? super.tags(...a);
      }
    }
    const brief = must(PRESETS[0]).brief;
    const free = await runTastemaker(brief, { qloo: new Capped(Infinity), llm: new DeterministicLLM() });
    const ids = free.trace.map((s) => s.id);
    expect(ids.indexOf("audit")).toBeGreaterThan(ids.indexOf("critic-1"));
    expect(ids.indexOf("audit")).toBeLessThan(ids.indexOf("critic-2"));
    // Leave the audit only a few calls: fewer than it needs.
    const before = free.trace.slice(0, ids.indexOf("audit")).reduce((n, s) => n + s.calls.length, 0);
    const needs = must(free.trace.find((s) => s.id === "audit")).calls.length;
    const tight = await runTastemaker(brief, { qloo: new Capped(before + Math.floor(needs / 2)), llm: new DeterministicLLM() });
    const audit = must(tight.trace.find((s) => s.id === "audit"));
    expect(audit.status).toBe("done");
    expect(audit.detail).toMatch(/cut short \(Qloo call budget/);
    expect(tight.baseline.unavailable).toBeUndefined();
    const judged = tight.baseline.receipts.filter((x) => x.verdict !== "unscored");
    const notChecked = tight.baseline.receipts.filter((x) => x.verdict === "unscored");
    expect(judged.length).toBeGreaterThan(0);
    expect(notChecked.length).toBeGreaterThan(0);
    expect(notChecked.every((x) => /Not checked/.test(x.note))).toBe(true);
    // Whatever the free run judged and the tight run judged agree: a cut never changes a verdict, it only withholds one.
    for (const x of judged) expect(free.baseline.receipts.find((y) => y.role === x.role && y.name === x.name)?.verdict).toBe(x.verdict);
  });

  it("stays under the run's Qloo estimate on every preset", async () => {
    for (const p of PRESETS) {
      const r = await runTastemaker(p.brief, { qloo: offline(), llm: new DeterministicLLM() });
      expect(r.qloo.calls, p.id).toBeLessThanOrEqual(80);
    }
  });
});

describe("client caching and replay", () => {
  it("treats a reply with no results as empty, in either documented form", () => {
    expect(isEmptyReply({ results: [] })).toBe(true);
    expect(isEmptyReply({ results: { entities: [] } })).toBe(true);
    expect(isEmptyReply({ results: { trending: [], extra: 1 } })).toBe(true);
    expect(isEmptyReply({ success: true })).toBe(true);
    expect(isEmptyReply({ results: [{ name: "x" }] })).toBe(false);
    expect(isEmptyReply({ results: { entities: [{ entity_id: "e" }] } })).toBe(false);
  });

  it("caches an empty live reply briefly, a full one for the week", async () => {
    const sets: { key: string; ttl: number }[] = [];
    const store = new MemoryCache();
    const cache: CacheStore = { get: (k) => store.get(k), set: (k, v, ttl) => (sets.push({ key: k, ttl }), store.set(k, v, ttl)) };
    const replies: Record<string, unknown> = { a: { results: { entities: [] } }, b: { results: { entities: [{ name: "N", entity_id: "e", query: { affinity: 0.4 } }] } } };
    const fetchImpl = (async (url: URL) => Response.json(replies[new URL(url).searchParams.get("signal.interests.entities") ?? ""])) as unknown as typeof fetch;
    const c = new QlooClient({ apiKey: "k", cache, fixtures: {}, fetchImpl });
    await c.insights("urn:entity:artist", { "signal.interests.entities": ["a"] });
    await c.insights("urn:entity:artist", { "signal.interests.entities": ["b"] });
    expect(sets.map((s) => s.ttl)).toEqual([EMPTY_TTL, 60 * 60 * 24 * 7]);
    expect(EMPTY_TTL).toBeLessThanOrEqual(60 * 30);
  });

  it("replays the newest recorded trending series of the same entity when the weekly window has moved on", async () => {
    const at = (start: string, end: string) => requestKey("/v2/trending", { "filter.type": "urn:entity:movie", "signal.interests.entities": "m1", "filter.start_date": start, "filter.end_date": end });
    const point = (date: string, d: number) => ({ results: { trending: [{ date, population_percent_delta: d }] } });
    const fixtures = { [at("2026-08-31", "2026-10-12")]: point("2026-10-12", 2), [at("2026-08-24", "2026-10-05")]: point("2026-10-05", -9) };
    const c = new QlooClient({ cache: new MemoryCache(), fixtures });
    const r = await c.trending("movie", "m1", { start: "2026-09-07", end: "2026-10-19" });
    expect(r.meta.source).toBe("replay");
    expect(r.data.results.trending[0]?.population_percent_delta).toBe(2);
    expect(trendFamily(at("a", "b"))).toBe(trendFamily(at("c", "d")));
    expect(trendFamily("/v2/insights?filter.type=x")).toBeUndefined();
    // another entity has no recording: the labelled simulator answers
    expect((await c.trending("movie", "m2", { start: "2026-09-07", end: "2026-10-19" })).meta.source).toBe("simulated");
  });
});
