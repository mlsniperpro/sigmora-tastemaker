import { describe, expect, it } from "vitest";
import { QlooParamError, assertParams, checkParams, requestKey } from "@/lib/qloo/params";

describe("Qloo parameter validation", () => {
  it("accepts a valid insights request", () => {
    expect(checkParams("/v2/insights", { "filter.type": "urn:entity:artist", "signal.interests.entities": ["a"], take: 5 })).toEqual([]);
  });

  it("rejects a param the filter.type does not support (the silent-drop bug class)", () => {
    const problems = checkParams("/v2/insights", { "filter.type": "urn:entity:artist", "filter.price_level.min": 2 });
    expect(problems.join()).toMatch(/filter.price_level.min/);
  });

  it("accepts price level on places", () => {
    expect(checkParams("/v2/insights", { "filter.type": "urn:entity:place", "filter.price_level.min": 2 })).toEqual([]);
  });

  it("requires signal.interests.entities for destinations", () => {
    expect(checkParams("/v2/insights", { "filter.type": "urn:entity:destination" }).join()).toMatch(/required/);
  });

  it("rejects unknown filter types and heatmap boundaries", () => {
    expect(checkParams("/v2/insights", { "filter.type": "urn:entity:videogame" })).toHaveLength(1);
    expect(checkParams("/v2/insights", { "filter.type": "urn:heatmap", "output.heatmap.boundary": "planet" }).join()).toMatch(/boundary/);
  });

  it("throws outside production", () => {
    expect(() => assertParams("/search", {}, true)).toThrow(QlooParamError);
    expect(assertParams("/search", {}, false)).toHaveLength(1);
  });

  it("builds an order-independent, credential-free key", () => {
    const a = requestKey("/v2/insights", { take: 3, "filter.type": "urn:tag", x: undefined });
    const b = requestKey("/v2/insights", { "filter.type": "urn:tag", take: 3 });
    expect(a).toBe(b);
    expect(a).toBe("/v2/insights?filter.type=urn%3Atag&take=3");
  });
});
