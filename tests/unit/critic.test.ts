import { describe, it, expect } from "vitest";
import { fc, test } from "@fast-check/vitest";
import { ROLE_SPEC, ROLES } from "@/lib/agent/brief";
import { DEFAULT_CRITIC, isFading, makeCtx, type Audience, type Ctx, type RankedCandidate } from "@/lib/agent/context";
import { chooseReplacements, critique, metricsOf, thresholdFor } from "@/lib/agent/critic";
import type { Receipt, Verdict } from "@/lib/agent/types";
import type { Pick } from "@/lib/llm/types";
import { MemoryCache } from "@/lib/qloo/cache";
import { QlooClient } from "@/lib/qloo/client";
import { must } from "../must";

const audience: Audience = { ages: ["25_to_29", "30_to_34"] };
const ctxWith = (candidates: Ctx["candidates"], a: Audience = audience): Ctx => {
  const c = makeCtx(a, new QlooClient({ cache: new MemoryCache(), fixtures: {} }), [{ name: "Tems", entityId: "t" }]);
  c.candidates = candidates;
  return c;
};
const cand = (name: string, affinity: number, type: RankedCandidate["type"] = "artist"): RankedCandidate => ({ name, type, affinity, entityId: `id-${name}` });
const receipt = (name: string, verdict: Verdict, role: Receipt["role"] = "collab", affinity?: number): Receipt => ({ name, type: "artist", role, verdict, affinity, drivers: [], calls: [], note: "" });
const picksOf = (names: string[], role: Pick["role"] = "collab"): Pick[] => names.map((n) => ({ name: n, type: "artist", role, rationale: "" }));

describe("ROLE_SPEC", () => {
  it("covers every role, with at least one type and a positive count", () => {
    for (const r of ROLES) {
      expect(ROLE_SPEC[r].types.length).toBeGreaterThan(0);
      expect(ROLE_SPEC[r].count).toBeGreaterThan(0);
    }
  });
});

describe("thresholdFor", () => {
  test.prop([fc.array(fc.double({ min: 0, max: 1, noNaN: true }), { minLength: 1, maxLength: 12 })])("median bar: max(floor, ratio × median), never above the best candidate unless the floor is", (affs) => {
    const ctx = ctxWith({ collab: affs.map((a, i) => cand(`a${i}`, a)) });
    const t = thresholdFor(ctx, "collab");
    expect(t).toBeGreaterThanOrEqual(DEFAULT_CRITIC.minAffinity - 0.0005);
    expect(t).toBeLessThanOrEqual(Math.max(DEFAULT_CRITIC.minAffinity, Math.max(...affs)) + 0.0005);
  });
  test.prop([fc.array(fc.double({ min: 0, max: 1, noNaN: true }), { minLength: 1, maxLength: 14 })])("top-3 bar (cities): the third-best candidate, or the last when fewer", (affs) => {
    const ctx = ctxWith({ city: affs.map((a, i) => cand(`c${i}`, a, "locality")) });
    const sorted = [...affs].sort((a, b) => b - a);
    expect(thresholdFor(ctx, "city")).toBe(sorted[Math.min(2, sorted.length - 1)]);
  });
  it("sets no bar (rather than a made-up one) when Qloo returned no candidates", () => {
    expect(thresholdFor(ctxWith({}), "collab")).toBeUndefined();
  });
});

describe("metricsOf", () => {
  const verdict = fc.constantFrom<Verdict>("pass", "miss", "hallucination", "fading", "unscored");
  test.prop([fc.array(verdict, { maxLength: 30 })])("counts add up and the miss rate is in [0, 1]", (vs) => {
    const m = metricsOf(vs.map((v, i) => receipt(`n${i}`, v)));
    expect(m.picks).toBe(vs.length);
    expect(m.hallucinations + m.misses + m.fading + m.unscored).toBe(vs.filter((v) => v !== "pass").length);
    expect(m.cultureMissRate).toBeGreaterThanOrEqual(0);
    expect(m.cultureMissRate).toBeLessThanOrEqual(1);
  });
  it("leaves unscored picks out of the rate instead of counting them as passes or misses", () => {
    expect(metricsOf([receipt("a", "unscored"), receipt("b", "miss")]).cultureMissRate).toBe(1);
    expect(metricsOf([receipt("a", "unscored")]).cultureMissRate).toBe(0);
  });
  it("counts fading as a warning, not a miss", () => {
    expect(metricsOf([receipt("a", "fading"), receipt("b", "pass")]).cultureMissRate).toBe(0);
  });
});

describe("isFading", () => {
  it("needs a reading below the threshold", () => {
    const ctx = ctxWith({});
    ctx.trends.set("a", -0.9).set("b", 0.2);
    expect([isFading(ctx, "a"), isFading(ctx, "b"), isFading(ctx, "none")]).toEqual([true, false, false]);
  });
});

describe("chooseReplacements", () => {
  it("offers the best unused, untried candidate of the same role", () => {
    const ctx = ctxWith({ collab: [cand("Ayra Starr", 0.9), cand("Victony", 0.8), cand("Omah Lay", 0.7)] });
    const reps = chooseReplacements(ctx, picksOf(["Ayra Starr", "Ed Sheeran"]), [receipt("Ayra Starr", "pass"), receipt("Ed Sheeran", "miss", "collab", 0.1)], new Set());
    expect(reps).toEqual([expect.objectContaining({ from: "Ed Sheeran", to: "Victony", role: "collab" })]);
  });

  it("never proposes the same swap twice across rounds, matching names loosely", () => {
    const ctx = ctxWith({ collab: [cand("Victony", 0.8), cand("Omah Lay", 0.7)] });
    const tried = new Set<string>();
    const r1 = chooseReplacements(ctx, picksOf(["Ed Sheeran"]), [receipt("Ed Sheeran", "miss")], tried);
    // the model resubmitted the rejected pick in another spelling
    const r2 = chooseReplacements(ctx, picksOf(["ed sheeran"]), [receipt("ed sheeran", "miss")], tried);
    expect(r1[0]?.to).toBe("Victony");
    expect(r2[0]?.to).toBe("Omah Lay");
    expect(chooseReplacements(ctx, picksOf(["Ed Sheeran"]), [receipt("Ed Sheeran", "miss")], tried)).toEqual([]);
  });

  test.prop([fc.uniqueArray(fc.stringMatching(/^[A-Z][a-z]{2,7}$/), { minLength: 2, maxLength: 12, selector: (s) => s.toLowerCase() }), fc.array(fc.boolean(), { minLength: 12, maxLength: 12 })])(
    "never proposes a name already in the plan, already tried, or twice",
    (names, failing) => {
      const inPlan = names.slice(0, Math.ceil(names.length / 2));
      const ctx = ctxWith({ collab: names.map((n, i) => cand(n, 1 - i / 20)) });
      const receipts = inPlan.map((n, i) => receipt(n, failing[i] ? "miss" : "pass"));
      const reps = chooseReplacements(ctx, picksOf(inPlan), receipts, new Set());
      const tos = reps.map((r) => r.to);
      expect(new Set(tos).size).toBe(tos.length);
      tos.forEach((t) => expect(inPlan).not.toContain(t));
      reps.forEach((r) => expect(receipts.find((x) => x.name === r.from)?.verdict).not.toBe("pass"));
    },
  );

  it("skips fading references and won't move a fixed market", () => {
    const ctx = ctxWith({ reference: [cand("Old Show", 0.9, "tv_show"), cand("New Show", 0.8, "tv_show")], city: [cand("Houston", 0.9, "locality")] }, { ...audience, targetCity: "Atlanta" });
    ctx.trends.set("id-Old Show", -0.9);
    const reps = chooseReplacements(ctx, picksOf(["x"]), [receipt("Barbie", "fading", "reference"), receipt("Dallas", "miss", "city")], new Set());
    expect(reps.map((r) => r.to)).toEqual(["New Show"]);
  });
});

describe("critique (offline)", () => {
  it("scores cities from the ranked pool, without another call, and resolves later passes from memo", async () => {
    const ctx = ctxWith({ city: [cand("Washington", 0.7, "locality"), cand("Houston", 0.5, "locality"), cand("Atlanta", 0.4, "locality"), cand("Dallas", 0.2, "locality")] });
    for (const c of ctx.candidates.city ?? []) c.key = "rank-call";
    const keys: string[] = [];
    ctx.qloo.observe((m) => keys.push(m.key));
    const { receipts } = await critique(ctx, [...picksOf(["Washington", "Dallas"], "city")]);
    expect(receipts.map((r) => [r.name, r.verdict, r.affinity])).toEqual([
      ["Washington", "pass", 0.7],
      ["Dallas", "miss", 0.2],
    ]);
    expect(receipts[0]?.calls).toEqual(["rank-call"]);
    expect(keys).toEqual([]);
  });

  it("passes the brief's fixed market and misses any other city, by name", async () => {
    const ctx = ctxWith({}, { ...audience, targetCity: "Atlanta" });
    const { receipts } = await critique(ctx, picksOf(["Atlanta", "Dallas"], "city"));
    expect(receipts.map((r) => r.verdict)).toEqual(["pass", "miss"]);
    expect(must(receipts[0]).affinity).toBeUndefined();
  });

  it("re-scores only entities it hasn't seen", async () => {
    const ctx = ctxWith({});
    const keys: string[] = [];
    ctx.qloo.observe((m) => keys.push(m.key));
    await critique(ctx, picksOf(["Ayra Starr", "Victony"]));
    const first = keys.length;
    await critique(ctx, picksOf(["Ayra Starr", "Victony"]));
    expect(keys.length).toBe(first);
  });
});

describe("critic honesty", () => {
  const live = (o: Partial<Record<"insights", QlooClient["insights"]>> = {}) => {
    const q = new QlooClient({ cache: new MemoryCache(), fixtures: {} });
    if (o.insights) q.insights = o.insights;
    return q;
  };

  it("searches every type before calling a name 'not found', and says what it searched", async () => {
    const ctx = ctxWith({ collab: [cand("Ayra Starr", 0.9)] });
    const { receipts } = await critique(ctx, picksOf(["Lagos Velvet Collective"]));
    const r = must(receipts[0]);
    expect(r.verdict).toBe("hallucination");
    expect(r.calls).toHaveLength(2);
    expect(r.calls[1]).not.toMatch(/types=/);
    expect(r.note).toMatch(/Not found in Qloo/);
    expect(r.affinity).toBeUndefined();
  });

  it("calls a real entity filed under another type a role mismatch, not an invention", async () => {
    const ctx = ctxWith({ collab: [cand("Ayra Starr", 0.9)] });
    const r = must((await critique(ctx, picksOf(["Insecure"]))).receipts[0]);
    expect(r.verdict).toBe("miss");
    expect(r.note).toMatch(/files "Insecure" as tv show/);
  });

  it("shows no number when Qloo gives no score, and doesn't count it as a miss", async () => {
    const empty: QlooClient["insights"] = async (type, params) => {
      const q = new QlooClient({ cache: new MemoryCache(), fixtures: {} });
      const r = await q.insights(type, params);
      return params["filter.results.entities"] ? { ...r, data: { ...r.data, results: { ...r.data.results, entities: [] } } } : r;
    };
    const ctx = makeCtx(audience, live({ insights: empty }), [{ name: "Tems", entityId: "t" }]);
    ctx.candidates = { collab: [cand("Ayra Starr", 0.9)] };
    const r = must((await critique(ctx, picksOf(["Burna Boy"]))).receipts[0]);
    expect(r.verdict).toBe("unscored");
    expect(r.affinity).toBeUndefined();
    expect(metricsOf([r]).cultureMissRate).toBe(0);
  });

  it("marks a pick unscored, not missed, when its role has no candidate pool", async () => {
    const ctx = ctxWith({});
    const r = must((await critique(ctx, picksOf(["Burna Boy"]))).receipts[0]);
    expect(r.verdict).toBe("unscored");
    expect(r.threshold).toBeUndefined();
    expect(r.note).toMatch(/no candidates for this role/);
  });
});
