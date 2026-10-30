import { describe, expect, it } from "vitest";
import { SURFACES, surfaceOf } from "@/lib/agent/surfaces";
import { PRESETS } from "@/lib/agent/presets";
import { runTastemaker } from "@/lib/agent/run";
import { DeterministicLLM } from "@/lib/llm/deterministic";
import { MemoryCache } from "@/lib/qloo/cache";
import { QlooClient } from "@/lib/qloo/client";

describe("surfaceOf", () => {
  it("maps request keys onto the playbook's surfaces, not one per filter.type", () => {
    expect(surfaceOf("/v2/trending?filter.type=urn:entity:artist&signal.interests.entities=a")).toBe(SURFACES.trending);
    expect(surfaceOf("/v2/trending?filter.type=urn:entity:movie&signal.interests.entities=a")).toBe(SURFACES.trending);
    expect(surfaceOf("/v2/insights?filter.type=urn:entity:artist&take=10")).toBe(SURFACES.insights);
    expect(surfaceOf("/v2/insights?filter.type=urn:entity:brand&take=10")).toBe(SURFACES.insights);
    expect(surfaceOf("/v2/insights?feature.explainability=true&filter.results.entities=a&filter.type=urn:entity:artist")).toBe(SURFACES.critic);
    expect(surfaceOf("/v2/insights?filter.location.query=Atlanta&filter.type=urn:entity:place")).toBe(SURFACES.location);
    expect(surfaceOf("/v2/insights?filter.type=urn:heatmap&filter.location=POLYGON((0 0))")).toBe(SURFACES.heatmap);
    expect(surfaceOf("/entities?external.spotify.ids=x")).toBe(SURFACES.entities);
  });

  it("the hero run touches at least 10 distinct surfaces", async () => {
    const r = await runTastemaker(PRESETS[0].brief, { qloo: new QlooClient({ cache: new MemoryCache(), fixtures: {} }), llm: new DeterministicLLM() });
    const used = new Set(r.trace.flatMap((s) => s.calls.map((c) => surfaceOf(c.key))));
    expect(used.size).toBeGreaterThanOrEqual(10);
    expect(used).toContain(SURFACES.critic);
  });
});
