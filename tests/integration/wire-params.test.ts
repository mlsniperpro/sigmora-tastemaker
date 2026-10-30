/** What actually goes on the wire: discovery calls carry bias.trends, the tag call diversify.*, scoring calls bias.trends=off (Qloo defaults to medium) and no diversify. */
import { describe, expect, it } from "vitest";
import { Brief } from "@/lib/agent/brief";
import { DIVERSIFY_TAKE, discoveryParams, tagDiscoveryParams } from "@/lib/agent/context";
import { PRESETS } from "@/lib/agent/presets";
import { runTastemaker } from "@/lib/agent/run";
import { DeterministicLLM } from "@/lib/llm/deterministic";
import { MemoryCache } from "@/lib/qloo/cache";
import { QlooClient } from "@/lib/qloo/client";
import { checkParams, type QlooPath } from "@/lib/qloo/params";
import { simulate } from "@/lib/qloo/sim/simulator";
import { must } from "../must";

/** A live-mode client whose "network" is the simulator, recording every URL sent. */
function wiredClient() {
  const urls: URL[] = [];
  const fetchImpl = async (url: URL) => {
    urls.push(new URL(url));
    return Response.json(simulate(url.pathname as QlooPath, Object.fromEntries(url.searchParams)));
  };
  return { urls, qloo: new QlooClient({ apiKey: "k", cache: new MemoryCache(), fixtures: {}, fetchImpl: fetchImpl as unknown as typeof fetch }) };
}

const insights = (urls: URL[], type: string) => urls.filter((u) => u.pathname === "/v2/insights" && u.searchParams.get("filter.type") === `urn:entity:${type}`);
const discovery = (us: URL[]) => us.filter((u) => !u.searchParams.has("filter.results.entities"));
const scoring = (us: URL[]) => us.filter((u) => u.searchParams.has("filter.results.entities"));

describe("Qloo params on the wire", () => {
  const brief = Brief.parse(PRESETS[0].brief);

  it("sends bias.trends on timing-sensitive discovery, diversify.by=subtype only on urn:tag (the docs' rule), plain affinity (bias.trends=off) on scoring", async () => {
    const { urls, qloo } = wiredClient();
    const run = await runTastemaker(brief, { qloo, llm: new DeterministicLLM(), discovery: { trendBias: "high", diversify: true } });
    expect(run.sources).toEqual(["live"]);

    for (const t of ["artist", "tv_show", "movie", "podcast"]) {
      const found = discovery(insights(urls, t));
      expect(found.length, t).toBeGreaterThan(0);
      for (const u of found) {
        expect(u.searchParams.get("bias.trends"), t).toBe("high");
        expect(u.searchParams.has("diversify.by"), t).toBe(false);
      }
    }
    // `subtype` is valid for urn:tag only; brands have no geocode to group by, and venues are already one city's.
    for (const t of ["brand", "place"]) {
      const found = discovery(insights(urls, t));
      expect(found.length, t).toBeGreaterThan(0);
      for (const u of found) {
        expect(u.searchParams.has("diversify.by"), t).toBe(false);
        expect(u.searchParams.has("bias.trends"), t).toBe(false);
      }
    }
    const tagCalls = urls.filter((u) => u.pathname === "/v2/insights" && u.searchParams.get("filter.type") === "urn:tag");
    expect(tagCalls.length).toBeGreaterThan(0);
    for (const u of tagCalls) {
      expect(u.searchParams.get("diversify.by")).toBe("subtype");
      expect(u.searchParams.get("diversify.take")).toBe(String(DIVERSIFY_TAKE));
      // The docs list no demographic signals for tags.
      expect(u.searchParams.has("signal.demographics.age")).toBe(false);
    }
    const scored = scoring(urls.filter((u) => u.pathname === "/v2/insights"));
    expect(scored.length).toBeGreaterThan(0);
    for (const u of scored) {
      // Qloo's default is bias.trends=medium, so plain affinity on the timing-sensitive types asks for "off".
      const biased = ["artist", "tv_show", "movie", "podcast"].some((t) => u.searchParams.get("filter.type") === `urn:entity:${t}`);
      expect(u.searchParams.get("bias.trends"), u.search).toBe(biased ? "off" : null);
      expect(u.searchParams.has("diversify.by")).toBe(false);
    }
    expect(scored.some((u) => u.searchParams.get("bias.trends") === "off")).toBe(true);
    expect(insights(urls, "locality").every((u) => !u.searchParams.has("bias.trends") && !u.searchParams.has("diversify.by"))).toBe(true);
  });

  it("pins every in-city call to the locality's own boundary (filter.location.radius=0; Qloo pads it otherwise)", async () => {
    const { urls, qloo } = wiredClient();
    // The DTC preset has a fixed launch city, so the in-city heatmap fires too.
    await runTastemaker(Brief.parse(must(PRESETS.find((p) => p.brief.targetCity)).brief), { qloo, llm: new DeterministicLLM() });
    const located = urls.filter((u) => u.searchParams.has("filter.location.query"));
    // Venue discovery, the critic's venue-in-city check and the in-city heatmap.
    expect(located.some((u) => u.searchParams.get("filter.type") === "urn:entity:place" && !u.searchParams.has("filter.results.entities"))).toBe(true);
    expect(located.some((u) => u.searchParams.get("filter.type") === "urn:entity:place" && u.searchParams.has("filter.results.entities"))).toBe(true);
    expect(located.some((u) => u.searchParams.get("filter.type") === "urn:heatmap")).toBe(true);
    for (const u of located) expect(u.searchParams.get("filter.location.radius"), u.search).toBe("0");
  });

  it("re-scores each trend-biased pool with plain affinity, so the pass bar matches how picks are scored", async () => {
    const { urls, qloo } = wiredClient();
    await runTastemaker(brief, { qloo, llm: new DeterministicLLM(), discovery: { trendBias: "high", diversify: true } });
    for (const t of ["artist", "tv_show", "movie", "podcast"]) {
      const [found] = discovery(insights(urls, t));
      const pool = simulate("/v2/insights", Object.fromEntries(must(found, t).searchParams)) as { results: { entities: { entity_id: string }[] } };
      const ids = pool.results.entities.map((e) => e.entity_id).sort();
      const rescore = scoring(insights(urls, t)).find((u) => u.searchParams.get("filter.results.entities")?.split(",").sort().join() === ids.join());
      expect(rescore, `${t} pool re-scored`).toBeDefined();
      expect(rescore?.searchParams.get("feature.explainability")).toBe("true");
    }
  });

  it('"off" stops sending bias.trends but keeps diversification', async () => {
    const { urls, qloo } = wiredClient();
    await runTastemaker(brief, { qloo, llm: new DeterministicLLM(), discovery: { trendBias: "off", diversify: true } });
    expect(urls.some((u) => u.searchParams.has("bias.trends"))).toBe(false);
    const tagCalls = urls.filter((u) => u.searchParams.get("filter.type") === "urn:tag");
    expect(tagCalls.length).toBeGreaterThan(0);
    expect(tagCalls.every((u) => u.searchParams.get("diversify.by") === "subtype")).toBe(true);
  });

  it("asks /v2/trending for one entity per call, inside a dated window, and only for fading-checked roles", async () => {
    const { urls, qloo } = wiredClient();
    await runTastemaker(brief, { qloo, llm: new DeterministicLLM(), discovery: { trendBias: "off", diversify: false } });
    const trends = urls.filter((u) => u.pathname === "/v2/trending");
    expect(trends.length).toBeGreaterThan(0);
    for (const u of trends) {
      expect(checkParams("/v2/trending", Object.fromEntries(u.searchParams))).toEqual([]);
      expect(u.searchParams.get("signal.interests.entities")?.split(",")).toHaveLength(1);
      expect(u.searchParams.get("filter.start_date")).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(u.searchParams.get("filter.end_date")).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      // reference is the only role whose verdict depends on fading (tv_show, movie)
      expect(["urn:entity:tv_show", "urn:entity:movie"]).toContain(u.searchParams.get("filter.type"));
    }
  });

  it("sends compare with the documented genre subtype and a heatmap with an explicit documented take", async () => {
    const { urls, qloo } = wiredClient();
    await runTastemaker(brief, { qloo, llm: new DeterministicLLM(), discovery: { trendBias: "off", diversify: false } });
    const cmp = urls.filter((u) => u.pathname === "/v2/analysis/compare");
    expect(cmp.length).toBe(1);
    expect(cmp[0]?.searchParams.get("filter.subtype")).toBe("urn:tag:genre");
    const heat = urls.filter((u) => u.searchParams.get("filter.type") === "urn:heatmap");
    expect(heat.length).toBeGreaterThan(0);
    for (const u of heat) expect(u.searchParams.get("take")).toBe("50");
  });
});

describe("QLOO_DIVERSIFY=off", () => {
  it("sends no diversify params", async () => {
    const { urls, qloo } = wiredClient();
    await runTastemaker(Brief.parse(PRESETS[0].brief), { qloo, llm: new DeterministicLLM(), discovery: { trendBias: "medium", diversify: false } });
    expect(urls.some((u) => u.searchParams.has("diversify.by") || u.searchParams.has("diversify.take"))).toBe(false);
  });
});

describe("discoveryParams", () => {
  it("produces only parameters the insights allow-list accepts", () => {
    for (const t of ["artist", "brand", "place", "tv_show", "movie", "podcast", "person"] as const) {
      for (const b of ["off", "low", "medium", "high"] as const) {
        expect(checkParams("/v2/insights", { "filter.type": `urn:entity:${t}`, ...discoveryParams(t, { trendBias: b, diversify: true }) }), `${t}/${b}`).toEqual([]);
      }
    }
  });
  it("produces tag-call parameters the urn:tag allow-list accepts", () => {
    expect(checkParams("/v2/insights", { "filter.type": "urn:tag", "signal.interests.entities": ["a"], ...tagDiscoveryParams({ trendBias: "off", diversify: true }), take: 10 })).toEqual([]);
  });
  it("rejects malformed values before they leave the server", () => {
    expect(checkParams("/v2/insights", { "filter.type": "urn:entity:artist", "bias.trends": "max" })).toEqual(['bias.trends "max" is not one of off, very_low, low, mid, medium, high, very_high']);
    expect(checkParams("/v2/insights", { "filter.type": "urn:entity:place", "diversify.take": 3 })).toEqual(["diversify.take needs diversify.by"]);
  });
});

describe("diversify.by (insights deep dive: subtype on urn:tag only; geocode city/metro on located entities)", () => {
  it("accepts subtype on urn:tag and the geocode fields on places", () => {
    expect(checkParams("/v2/insights", { "filter.type": "urn:tag", "diversify.by": "subtype", "diversify.take": 3 })).toEqual([]);
    for (const by of ["properties.geocode.city", "properties.geocode.metro"]) {
      expect(checkParams("/v2/insights", { "filter.type": "urn:entity:place", "diversify.by": by, "diversify.take": 2 }), by).toEqual([]);
    }
  });
  it("rejects subtype on entities, geocode on tags, and diversify on types the docs don't list it for", () => {
    expect(checkParams("/v2/insights", { "filter.type": "urn:entity:place", "diversify.by": "subtype" })).toEqual([
      'diversify.by "subtype" is not valid for urn:entity:place (use properties.geocode.city or properties.geocode.metro)',
    ]);
    expect(checkParams("/v2/insights", { "filter.type": "urn:tag", "diversify.by": "properties.geocode.city" })).toEqual(['diversify.by "properties.geocode.city" is not valid for urn:tag (use subtype)']);
    expect(checkParams("/v2/insights", { "filter.type": "urn:entity:brand", "diversify.by": "subtype" })).toEqual(['"diversify.by" is not supported for /v2/insights (urn:entity:brand)']);
  });
});
