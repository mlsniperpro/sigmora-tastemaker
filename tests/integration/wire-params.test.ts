/** What actually goes on the wire: discovery calls carry bias.trends / diversify.*, scoring calls never do. */
import { describe, expect, it } from "vitest";
import { Brief } from "@/lib/agent/brief";
import { DIVERSIFY_TAKE, discoveryParams } from "@/lib/agent/context";
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

  it("sends bias.trends on timing-sensitive discovery, diversify.by=subtype on brands and venues, neither on scoring", async () => {
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
    for (const t of ["brand", "place"]) {
      const found = discovery(insights(urls, t));
      expect(found.length, t).toBeGreaterThan(0);
      for (const u of found) {
        expect(u.searchParams.get("diversify.by"), t).toBe("subtype");
        expect(u.searchParams.get("diversify.take"), t).toBe(String(DIVERSIFY_TAKE));
        expect(u.searchParams.has("bias.trends"), t).toBe(false);
      }
    }
    const scored = scoring(urls.filter((u) => u.pathname === "/v2/insights"));
    expect(scored.length).toBeGreaterThan(0);
    for (const u of scored) {
      expect(u.searchParams.has("bias.trends")).toBe(false);
      expect(u.searchParams.has("diversify.by")).toBe(false);
    }
    expect(insights(urls, "locality").every((u) => !u.searchParams.has("bias.trends") && !u.searchParams.has("diversify.by"))).toBe(true);
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
    expect(discovery(insights(urls, "brand")).every((u) => u.searchParams.get("diversify.by") === "subtype")).toBe(true);
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
  it("rejects malformed values before they leave the server", () => {
    expect(checkParams("/v2/insights", { "filter.type": "urn:entity:artist", "bias.trends": "max" })).toEqual(['bias.trends "max" is not low, medium or high']);
    expect(checkParams("/v2/insights", { "filter.type": "urn:entity:brand", "diversify.take": 3 })).toEqual(["diversify.take needs diversify.by"]);
  });
});
