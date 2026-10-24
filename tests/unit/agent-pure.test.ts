import { describe, expect } from "vitest";
import { fc, it } from "@fast-check/vitest";
import { Brief } from "@/lib/agent/brief";
import { briefFromForm } from "@/lib/agent/briefForm";
import { FOLD_RADIUS_KM, foldHeatmap, haversineKm, topCells } from "@/lib/agent/cities";
import { parseSeedLinks, resolvedType, signalAges, signalFor } from "@/lib/agent/context";
import { PRESETS } from "@/lib/agent/presets";
import { NdjsonParser } from "@/lib/ndjson";
import { decodeBrief, encodeBrief } from "@/lib/permalink";
import { schedule } from "@/lib/publisher";
import { wktBBox } from "@/lib/qloo/sim/simulator";
import { AGE_BUCKETS } from "@/lib/qloo/types";

describe("signals", () => {
  it("maps fine age buckets to the coarse signal buckets", () => {
    expect(signalAges(["25_to_29", "30_to_34", "35_to_44"])).toEqual(["35_and_younger", "36_to_55"]);
    expect(signalAges(["55_and_older"])).toEqual(["55_and_older"]);
  });
  it.prop([fc.subarray([...AGE_BUCKETS])])("signal buckets are unique and known", (ages) => {
    const out = signalAges(ages);
    expect(new Set(out).size).toBe(out.length);
    out.forEach((b) => expect(["35_and_younger", "36_to_55", "55_and_older"]).toContain(b));
  });
  it("conditions every call on seeds, vibe tags and demographics", () => {
    const ctx = { audience: { ages: ["25_to_29" as const], gender: "female" as const }, seedIds: ["a"], tagIds: ["t"] };
    expect(signalFor(ctx)).toEqual({ "signal.interests.entities": ["a"], "signal.interests.tags": ["t"], "signal.demographics.age": ["35_and_younger"], "signal.demographics.gender": "female" });
  });
  it("scores a search hit as the searched type unless it's clearly another type the role allows", () => {
    const hit = (types: string[]) => ({ name: "x", entity_id: "1", types });
    expect(resolvedType("presenter", "person", hit(["urn:entity:artist", "urn:entity:person"]))).toBe("person");
    expect(resolvedType("reference", "tv_show", hit(["urn:entity:movie"]))).toBe("movie");
    expect(resolvedType("collab", "artist", hit(["urn:entity:place:venue"]))).toBe("artist");
  });
});

describe("seed links", () => {
  it("extracts Spotify artist and IMDb ids from real-looking links", () => {
    expect(
      parseSeedLinks([
        "https://open.spotify.com/artist/0123456789abcdefABCDEF?si=x",
        "https://open.spotify.com/intl-fr/artist/0123456789abcdefABCDEF",
        "https://www.imdb.com/title/tt1234567/",
        "https://imdb.com/name/nm0000123",
      ]),
    ).toEqual({ spotify: ["0123456789abcdefABCDEF"], imdb: ["tt1234567", "nm0000123"] });
  });
  it("ignores look-alike hosts (links are parsed, never fetched)", () => {
    expect(parseSeedLinks(["https://evil.example/open.spotify.com/artist/0123456789abcdef", "http://open.spotify.com/artist/0123456789abcdef", "https://imdb.com.evil.example/title/tt1234567"])).toEqual({ spotify: [], imdb: [] });
  });
  it.prop([fc.array(fc.webUrl(), { maxLength: 5 })])("never throws on arbitrary URLs", (urls) => {
    expect(() => parseSeedLinks(urls)).not.toThrow();
  });
});

describe("cities", () => {
  const point = fc.record({ lat: fc.double({ min: -80, max: 80, noNaN: true }), lon: fc.double({ min: -179, max: 179, noNaN: true }) });
  it.prop([point, point])("haversine is symmetric, non-negative and zero on itself", (a, b) => {
    expect(haversineKm(a, b)).toBeCloseTo(haversineKm(b, a), 6);
    expect(haversineKm(a, b)).toBeGreaterThanOrEqual(0);
    expect(haversineKm(a, a)).toBeCloseTo(0, 6);
  });
  it("knows roughly how far Atlanta is from Houston", () => {
    expect(haversineKm({ lat: 33.75, lon: -84.39 }, { lat: 29.76, lon: -95.37 })).toBeGreaterThan(1100);
    expect(haversineKm({ lat: 33.75, lon: -84.39 }, { lat: 29.76, lon: -95.37 })).toBeLessThan(1200);
  });
  const cell = fc.record({ lat: fc.double({ min: 25, max: 49, noNaN: true }), lon: fc.double({ min: -124, max: -67, noNaN: true }), affinity: fc.double({ min: 0, max: 1, noNaN: true }) });
  it.prop([fc.array(cell, { maxLength: 200 })])("folded city affinity is the mean of nearby cells, within their range", (cells) => {
    const city = { name: "C", affinity: 0, lat: 35, lon: -95 };
    const [folded] = foldHeatmap([city], cells);
    const near = cells.filter((c) => haversineKm(city, c) <= FOLD_RADIUS_KM);
    if (!near.length) expect(folded).toBeUndefined();
    else {
      expect(folded.affinity).toBeGreaterThanOrEqual(Math.min(...near.map((c) => c.affinity)) - 0.001);
      expect(folded.affinity).toBeLessThanOrEqual(Math.max(...near.map((c) => c.affinity)) + 0.001);
    }
  });
  it("skips cities without coordinates", () => {
    expect(foldHeatmap([{ name: "X", affinity: 0 }], [{ lat: 0, lon: 0, affinity: 1 }])).toEqual([]);
  });
  it.prop([fc.array(cell, { maxLength: 600 }), fc.integer({ min: 0, max: 500 })])("topCells is bounded and sorted by affinity", (cells, max) => {
    const out = topCells(cells, max);
    expect(out.length).toBe(Math.min(max, cells.length));
    for (let i = 1; i < out.length; i++) expect(out[i - 1].affinity).toBeGreaterThanOrEqual(out[i].affinity);
  });
  it("parses WKT polygon bounding boxes (longitude first) and rejects junk", () => {
    expect(wktBBox("POLYGON((-125 24, -66 24, -66 50, -125 50, -125 24))")).toEqual({ minLon: -125, maxLon: -66, minLat: 24, maxLat: 50 });
    expect(wktBBox("POINT(1 2)")).toBeUndefined();
    expect(wktBBox("POLYGON((a b, 1 2))")).toBeUndefined();
  });
});

describe("permalinks", () => {
  const briefArb = fc.record({
    family: fc.constantFrom("music" as const, "dtc" as const, "sports" as const),
    subject: fc.string({ minLength: 1, maxLength: 80 }),
    product: fc.string({ minLength: 1, maxLength: 120 }),
    seeds: fc.array(fc.string({ minLength: 1, maxLength: 80 }), { minLength: 1, maxLength: 5 }),
    ages: fc.uniqueArray(fc.constantFrom(...AGE_BUCKETS), { minLength: 1, maxLength: 6 }),
    goal: fc.string({ minLength: 1, maxLength: 200 }),
  });
  it.prop([briefArb])("round-trips any valid brief, including non-ASCII text", (b) => {
    expect(decodeBrief(encodeBrief(b))).toEqual(Brief.parse(b));
  });
  it.prop([fc.string()])("returns undefined for junk instead of throwing", (s) => {
    const r = decodeBrief(s);
    expect(r === undefined || Brief.safeParse(r).success).toBe(true);
  });
  it("produces URL-safe text", () => {
    expect(encodeBrief(PRESETS[0].brief)).toMatch(/^[A-Za-z0-9_-]+$/);
  });
});

describe("NdjsonParser", () => {
  it.prop([fc.array(fc.jsonValue(), { maxLength: 20 }), fc.array(fc.nat(), { maxLength: 10 })])("yields the same values however the stream is chunked", (values, cuts) => {
    const text = values.map((v) => JSON.stringify(v) + "\n").join("");
    const points = [...new Set(cuts.map((c) => c % (text.length + 1)))].sort((a, b) => a - b);
    const p = new NdjsonParser<unknown>();
    const out: unknown[] = [];
    let prev = 0;
    for (const c of [...points, text.length]) {
      out.push(...p.push(text.slice(prev, c)));
      prev = c;
    }
    out.push(...p.end());
    expect(out).toEqual(values.map((v) => JSON.parse(JSON.stringify(v))));
  });
  it("flushes a final line without a newline", () => {
    const p = new NdjsonParser<unknown>();
    expect(p.push('{"a":1}\n{"b"')).toEqual([{ a: 1 }]);
    expect(p.push(":2}")).toEqual([]);
    expect(p.end()).toEqual([{ b: 2 }]);
  });
});

describe("briefFromForm", () => {
  it("trims, de-duplicates and caps seeds, and fills defaults", () => {
    const b = briefFromForm({ family: "music", subject: " ", product: "", seeds: "Tems, Rema,,Tems, A, B, C, D", link: " ", vibe: "", ages: ["25_to_29"], goal: "" });
    expect(b.seeds).toEqual(["Tems", "Rema", "A", "B", "C"]);
    expect(b.subject).toBe("My launch");
    expect(b.seedLinks).toEqual([]);
    expect(b.vibe).toBeUndefined();
    expect(Brief.safeParse(b).success).toBe(true);
  });
});

describe("schedule", () => {
  it.prop([fc.array(fc.record({ platform: fc.string({ maxLength: 10 }), text: fc.string({ maxLength: 10 }) }), { minLength: 1, maxLength: 8 }), fc.date({ min: new Date("2020-01-01"), max: new Date("2030-01-01"), noInvalidDate: true })])(
    "one post a day at 17:00 UTC, strictly after now, in order",
    (posts, now) => {
      const s = schedule({ posts }, now);
      expect(s).toHaveLength(posts.length);
      s.forEach((x, i) => {
        const d = new Date(x.scheduledFor);
        expect(d.getUTCHours()).toBe(17);
        expect(d.getTime()).toBeGreaterThan(now.getTime());
        if (i) expect(d.getTime() - new Date(s[i - 1].scheduledFor).getTime()).toBe(24 * 3600 * 1000);
      });
    },
  );
});
