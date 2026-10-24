import { describe, it, expect } from "vitest";
import { fc, test } from "@fast-check/vitest";
import { hashId, median, normName, sameName } from "@/lib/agent/util";
import { QlooParamError, assertParams, checkParams, requestKey } from "@/lib/qloo/params";

const name = fc.string({ minLength: 1, maxLength: 40 });

describe("names", () => {
  it("normName is idempotent on the soak counterexample and F.C. variants", () => {
    for (const s of ["_fC", "f c c", "Arsenal F.C.", "F.C. Barcelona", "f the c"]) expect(normName(normName(s)), s).toBe(normName(s));
    expect(normName("Arsenal F.C.")).toBe("arsenal");
    expect(normName("The Weeknd")).toBe("weeknd");
  });
  test.prop([fc.string({ maxLength: 60 })])("normName is idempotent", (s) => {
    expect(normName(normName(s))).toBe(normName(s));
  });
  test.prop([name])("sameName is reflexive for any name that normalizes to something", (s) => {
    fc.pre(normName(s).length > 0);
    expect(sameName(s, s)).toBe(true);
  });
  test.prop([name, name])("sameName is symmetric", (a, b) => {
    expect(sameName(a, b)).toBe(sameName(b, a));
  });
  test.prop([name])("ignores case, punctuation and a leading 'The'", (s) => {
    fc.pre(normName(s).length > 0);
    expect(sameName(s.toUpperCase(), `The ${s.toLowerCase()}!`)).toBe(sameName(s, s));
  });
  it("rejects fuzzy search noise for invented names", () => {
    expect(sameName("Lagos Velvet Collective", "Lagos")).toBe(false);
    expect(sameName("Black Panther", "Black Panther: Wakanda Forever")).toBe(false);
    expect(sameName("Arsenal F.C.", "Arsenal")).toBe(true);
    expect(sameName("SOB's", "SOBs")).toBe(true);
  });
});

describe("median", () => {
  test.prop([fc.array(fc.double({ noNaN: true, min: -1e6, max: 1e6 }), { minLength: 1, maxLength: 50 })])("lies between min and max and ignores order", (xs) => {
    const m = median(xs);
    expect(m).toBeGreaterThanOrEqual(Math.min(...xs));
    expect(m).toBeLessThanOrEqual(Math.max(...xs));
    expect(median([...xs].reverse())).toBe(m);
  });
  it("doesn't depend on the order of 0 and -0 (soak counterexample)", () => {
    expect(median([0, -0, 5e-324])).toBe(median([5e-324, -0, 0]));
    expect(Object.is(median([-0]), 0)).toBe(true);
  });
  it("is 0 for an empty list", () => {
    expect(median([])).toBe(0);
  });
});

describe("hashId", () => {
  test.prop([fc.string()])("is deterministic, short and URL-safe", (s) => {
    const h = hashId(s);
    expect(hashId(s)).toBe(h);
    expect(h).toMatch(/^[a-z0-9]{1,12}$/);
  });
});

describe("requestKey", () => {
  const params = fc.dictionary(
    fc.stringMatching(/^[a-z][a-z.]{0,20}$/),
    fc.oneof(fc.string({ maxLength: 10 }), fc.integer(), fc.boolean(), fc.array(fc.string({ maxLength: 5 }), { maxLength: 3 }), fc.constant(undefined)),
  );
  test.prop([params])("ignores key order and undefined values", (p) => {
    const shuffled = Object.fromEntries(Object.entries(p).reverse());
    const defined = Object.fromEntries(Object.entries(p).filter(([, v]) => v !== undefined));
    expect(requestKey("/v2/insights", shuffled)).toBe(requestKey("/v2/insights", p));
    expect(requestKey("/v2/insights", defined)).toBe(requestKey("/v2/insights", p));
  });
  it("is the same string the fixtures are keyed on", () => {
    expect(requestKey("/v2/insights", { take: 3, "filter.type": "urn:tag" })).toBe("/v2/insights?filter.type=urn%3Atag&take=3");
  });
});

describe("checkParams", () => {
  test.prop([fc.dictionary(fc.string({ maxLength: 30 }), fc.string({ maxLength: 10 }))])("never throws, whatever the params", (p) => {
    expect(() => checkParams("/v2/insights", { "filter.type": "urn:entity:artist", ...p })).not.toThrow();
  });
  it("accepts every param the agent sends", () => {
    expect(checkParams("/v2/insights", { "filter.type": "urn:heatmap", "signal.interests.entities": ["a"], "filter.location": "POLYGON((0 0,1 0,1 1,0 0))" })).toEqual([]);
    expect(checkParams("/v2/insights", { "filter.type": "urn:entity:place", "filter.location.query": "Atlanta", "filter.results.entities": ["x"], "feature.explainability": true })).toEqual([]);
    expect(checkParams("/v2/tags", { "filter.query": "afro", "feature.semantic_search": true, take: 5 })).toEqual([]);
  });
  it("catches the silent-drop bug class", () => {
    expect(checkParams("/v2/insights", { "filter.type": "urn:entity:artist", "filter.price_level.min": 2 }).join()).toMatch(/filter.price_level.min/);
    expect(checkParams("/v2/insights", { "filter.type": "urn:entity:videogame" })).toHaveLength(1);
    expect(checkParams("/v2/insights", { "filter.type": "urn:entity:destination" }).join()).toMatch(/required/);
    expect(checkParams("/entities", {}).join()).toMatch(/entity_ids/);
  });
});

describe("assertParams", () => {
  it("throws a typed error when strict and returns the problems otherwise", () => {
    expect(() => assertParams("/search", {}, true)).toThrow(QlooParamError);
    expect(assertParams("/search", {}, false)).toHaveLength(1);
  });
});
