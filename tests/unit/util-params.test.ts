import { describe, it, expect } from "vitest";
import { fc, test } from "@fast-check/vitest";
import { Brief } from "@/lib/agent/brief";
import { PRESETS } from "@/lib/agent/presets";
import { runKey } from "@/lib/agent/runCache";
import { isTitlePart, median, normName, numeralValue, sameName } from "@/lib/agent/util";
import { must } from "../must";
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

describe("sameName and numbers", () => {
  it("never accepts an invented sequel or edition", () => {
    expect(sameName("Grand Theft Auto VII", "Grand Theft Auto V")).toBe(false);
    expect(sameName("Grand Theft Auto V", "Grand Theft Auto VI")).toBe(false);
    expect(sameName("Rocky II", "Rocky III")).toBe(false);
    expect(sameName("FIFA 23", "FIFA 24")).toBe(false);
    expect(sameName("Toy Story 5", "Toy Story 4")).toBe(false);
    expect(sameName("Grand Theft Auto V", "Grand Theft Auto")).toBe(false);
  });
  it("still matches the same number written either way, and names whose words only look like numerals", () => {
    expect(sameName("Grand Theft Auto V", "grand theft auto v")).toBe(true);
    expect(sameName("Boyz II Men", "Boyz 2 Men")).toBe(true);
    expect(sameName("Blink-182", "Blink 182")).toBe(true);
    expect(sameName("Washington, DC", "Washington DC")).toBe(true);
    expect(sameName("The Civil Wars", "Civil Wars")).toBe(true);
    // Near-names are different entities: an invented sequel or tour never borrows the real one's verdict.
    expect(sameName("Black Panther Wakanda Rising", "Black Panther: Wakanda Forever")).toBe(false);
    expect(sameName("Taylor Swift Reputation Tour", "Taylor Swift Eras Tour")).toBe(false);
    expect(sameName("Swift Taylor", "Taylor Swift")).toBe(false);
    // Stylised spellings of the same name match (audit 7)…
    for (const [a, b] of [["Pink", "P!nk"], ["Kesha", "Ke$ha"], ["NWA", "N.W.A."], ["REM", "R.E.M."], ["ACDC", "AC/DC"], ["Mr Beast", "MrBeast"], ["Mo", "Mø"], ["Aeon", "Æon"], ["Lukasz", "Łukasz"], ["Florence and the Machine", "Florence + the Machine"], ["Sinéad O'Connor", "Sinead O Connor"], ["The The", "the the"]]) {
      expect(sameName(a ?? "", b ?? "")).toBe(true);
    }
    // …and different names still don't.
    expect(sameName("Rema", "Remastered")).toBe(false);
    expect(sameName("Nia Sol", "Nia Sol Tribute Band")).toBe(false);
    expect(sameName("Grand Theft Auto VII", "Grand Theft Auto V")).toBe(false);
    expect(sameName("The The", "FC")).toBe(false);
    // Club and company suffixes, "St." and spelled-out numbers (audit 8).
    for (const [a, b] of [["Real Madrid CF", "Real Madrid"], ["Nike, Inc.", "Nike"], ["St. Vincent", "Saint Vincent"], ["Fast Five", "Fast 5"], ["Ocean's Eleven", "Oceans 11"], ["Maroon Five", "Maroon 5"]]) {
      expect(sameName(a ?? "", b ?? ""), `${a ?? ""} = ${b ?? ""}`).toBe(true);
    }
    expect(sameName("Ocean's Twelve", "Ocean's Eleven")).toBe(false);
    expect(sameName("Fast Five", "Fast X")).toBe(false);
  });
  it("reads digits and roman numerals I–XXXIX, and nothing else", () => {
    expect([numeralValue("v"), numeralValue("vii"), numeralValue("iv"), numeralValue("ix"), numeralValue("xiv"), numeralValue("xxxix"), numeralValue("23")]).toEqual([5, 7, 4, 9, 14, 39, 23]);
    for (const w of ["mix", "dc", "civil", "dim", "vv", "iiii", "xl", "", "md", "lil"]) expect(numeralValue(w), w).toBeUndefined();
  });
  const word = fc.stringMatching(/^[a-z]{3,8}$/).filter((w) => numeralValue(w) === undefined);
  test.prop([fc.array(word, { minLength: 1, maxLength: 4 }), fc.integer({ min: 1, max: 39 }), fc.integer({ min: 1, max: 39 }), fc.boolean()])(
    "two names that differ only in their number are never the same, written as digits or roman numerals",
    (words, m, n, roman) => {
      fc.pre(m !== n);
      const toRoman = (k: number) => "x".repeat(Math.floor(k / 10)) + must(["", "i", "ii", "iii", "iv", "v", "vi", "vii", "viii", "ix"][k % 10]);
      const num = (k: number) => (roman ? toRoman(k) : String(k));
      const base = words.join(" ");
      expect(sameName(`${base} ${num(m)}`, `${base} ${num(n)}`)).toBe(false);
      expect(sameName(`${base} ${num(m)}`, `${base} ${toRoman(m)}`)).toBe(true);
      expect(numeralValue(toRoman(m))).toBe(m);
    },
  );
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

describe("isTitlePart", () => {
  it("accepts a title or its subtitle on its own, never a run inside a longer name", () => {
    expect(isTitlePart("Wakanda Forever", "Black Panther: Wakanda Forever")).toBe(true);
    expect(isTitlePart("The Daily Show", "The Daily Show with Trevor Noah")).toBe(true);
    expect(isTitlePart("Stranger Things", "Stranger Things - Season 4")).toBe(true);
    expect(isTitlePart("Boy", "Burna Boy")).toBe(false);
    expect(isTitlePart("Burna Boy", "Burna Boy")).toBe(false);
    // Audit 7: a run inside a longer name is another entity.
    expect(isTitlePart("Panther Wakanda", "Black Panther: Wakanda Forever")).toBe(false);
    expect(isTitlePart("Rema Dupe", "Rema Dupe Tribute Band")).toBe(false);
    expect(isTitlePart("Los Angeles", "Los Angeles Lakers")).toBe(false);
    expect(isTitlePart("Kendrick Lamar", "Kendrick Lamar Tribute")).toBe(false);
  });
  test.prop([fc.array(fc.stringMatching(/^[a-z]{2,8}$/), { minLength: 2, maxLength: 4 }), fc.array(fc.stringMatching(/^[a-z]{2,8}$/), { minLength: 2, maxLength: 4 })])(
    "each whole segment of 'Title: Subtitle' is a part; a strict run inside one segment never is",
    (title, sub) => {
      const t = title.join(" ");
      const u = sub.join(" ");
      fc.pre(normName(t).split(" ").length >= 2 && normName(u).split(" ").length >= 2 && normName(t) !== normName(u));
      expect(isTitlePart(t, `${t}: ${u}`)).toBe(true);
      expect(isTitlePart(u, `${t}: ${u}`)).toBe(true);
      const run = title.slice(0, -1).join(" ");
      if (normName(run).split(" ").length >= 2 && normName(run) !== normName(t)) expect(isTitlePart(run, `${t} ${u}`)).toBe(false);
    },
  );
});

describe("runKey", () => {
  const brief = Brief.parse(must(PRESETS[0]).brief);
  test.prop([fc.string({ maxLength: 80 }), fc.string({ maxLength: 80 })])("is deterministic, URL-safe and full-length SHA-256 per brief", (a, b) => {
    const k = (subject: string) => runKey({ ...brief, subject }, "llm", "live");
    expect(k(a)).toBe(k(a));
    expect(k(a)).toMatch(/^run:v\d+:[A-Za-z0-9_-]{43}$/);
    if (a !== b) expect(k(a)).not.toBe(k(b));
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
