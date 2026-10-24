import { describe, it, vi, expect } from "vitest";
import { fc, test } from "@fast-check/vitest";
import { Brief } from "@/lib/agent/brief";
import { PRESETS } from "@/lib/agent/presets";
import { renderReport, summarize, totals, type BenchRow } from "@/lib/benchmark/aggregate";
import { JUDGE_SYSTEM, blind, combine, judgePair, judgePrompt, renderPlan, seededRandom, sideOf, summarizeJudgements, type JudgeReply, type Outcome, type Side } from "@/lib/benchmark/judge";
import { judgeChatFromEnv } from "@/lib/llm";
import { NoRecordingError, ReplayChat, completionKey, type ChatClient } from "@/lib/llm/chat";
import { Draft } from "@/lib/llm/types";
import { must } from "../must";

const brief = Brief.parse(PRESETS[0].brief);
const plan = (name: string, rationale = "") =>
  Draft.parse({ positioning: `${name} for fans`, hooks: [`${name} nights`], script: "s", captions: [{ platform: "X", text: name }], musicBrief: "m", picks: [{ name, type: "artist", role: "collab", rationale }] });
const GROUNDED = plan("Ayra Starr", "Qloo affinity 0.90 for this audience");
const BASELINE = plan("Ed Sheeran");
const reply = (winner: "1" | "2" | "tie", s1 = 4, s2 = 3): JudgeReply => ({
  scores: { "1": { audienceFit: s1, specificity: s1, credibility: s1, freshness: s1 }, "2": { audienceFit: s2, specificity: s2, credibility: s2, freshness: s2 } },
  winner,
  reason: "r",
});

/** A judge that always prefers the plan naming `favourite`, whichever slot it's in. */
function fairJudge(favourite: string): ChatClient & { prompts: string[] } {
  const prompts: string[] = [];
  return {
    id: "fake:judge",
    model: "judge",
    prompts,
    async complete(_system, user) {
      prompts.push(user);
      const plan1 = user.split("=== Plan 2 ===")[0] ?? "";
      return JSON.stringify(reply(plan1.includes(favourite) ? "1" : "2"));
    },
  };
}

describe("blinding", () => {
  it("hides rationales, Qloo mentions and inline affinity scores from the judge", () => {
    const text = renderPlan(Draft.parse({ ...GROUNDED, positioning: "Qloo says Ayra Starr (0.87) fits" }));
    expect(text).not.toMatch(/qloo/i);
    expect(text).not.toMatch(/0\.87|0\.90/);
    expect(text).toContain("Ayra Starr");
    for (const tell of ["QLOO-grounded (affinity 0.9)", "Qloo-backed pick (affinity 1.00)", "affinity 0.91 for this audience", "Tems (0.87) and Rema (1.0)", "an affinity score of .82", "Qloo verified"]) {
      const out = blind(tell);
      expect(out, tell).not.toMatch(/qloo|affinity\s*\S*\d|\(\s*[01]?\.?\d+\s*\)/i);
    }
    expect(blind("Tems (0.87) headlines")).toBe("Tems headlines");
    expect(blind("Qloo says hi")).toBe("data says hi");
  });
  it("labels plans only by slot", () => {
    const p = judgePrompt(brief, GROUNDED, BASELINE);
    expect(p).toMatch(/=== Plan 1 ===[\s\S]*Ayra Starr[\s\S]*=== Plan 2 ===[\s\S]*Ed Sheeran/);
    expect(p).not.toMatch(/grounded|baseline|tastemaker/i);
    expect(JUDGE_SYSTEM).not.toMatch(/qloo/i);
  });
});

describe("position-bias handling", () => {
  const side = fc.constantFrom<Side>("grounded", "baseline");
  const winner = fc.constantFrom<"1" | "2" | "tie">("1", "2", "tie");
  test.prop([winner, side])("maps a slot verdict back to the side shown there", (w, first) => {
    const o = sideOf(w, first);
    if (w === "tie") expect(o).toBe("tie");
    else expect(o === first).toBe(w === "1");
  });
  test.prop([fc.constantFrom<Outcome>("grounded", "baseline", "tie"), fc.constantFrom<Outcome>("grounded", "baseline", "tie")])("combining is symmetric and only agreement wins", (a, b) => {
    expect(combine(a, b)).toEqual(combine(b, a));
    expect(combine(a, b).final).toBe(a === b ? a : "tie");
  });
  test.prop([fc.string()])("the seeded order is reproducible and in [0, 1)", (seed) => {
    const a = seededRandom(seed);
    const b = seededRandom(seed);
    for (let i = 0; i < 5; i++) {
      const x = a();
      expect(x).toBe(b());
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(1);
    }
  });
  it("seeded orders are roughly balanced across briefs", () => {
    const firsts = Array.from({ length: 200 }, (_, i) => seededRandom(`brief-${i}`)() < 0.5).filter(Boolean).length;
    expect(firsts).toBeGreaterThan(70);
    expect(firsts).toBeLessThan(130);
  });
});

describe("judgePair", () => {
  it("asks twice with positions swapped, and a fair judge's preference survives", async () => {
    const j = fairJudge("Ayra Starr");
    for (const r of [0.1, 0.9]) {
      const out = await judgePair(j, brief, GROUNDED, BASELINE, () => r);
      expect(out.orders.map((o) => o.firstShown)).toEqual(r < 0.5 ? ["grounded", "baseline"] : ["baseline", "grounded"]);
      expect(out).toMatchObject({ final: "grounded", consistent: true });
    }
    expect(j.prompts).toHaveLength(4);
  });

  it("scores a judge that always picks Plan 1 as a tie (pure position bias)", async () => {
    const biased: ChatClient = { id: "b", model: "b", complete: async () => JSON.stringify(reply("1")) };
    expect(await judgePair(biased, brief, GROUNDED, BASELINE, () => 0.3)).toMatchObject({ final: "tie", consistent: false });
  });

  it("repairs one unusable verdict, then gives up with a typed error", async () => {
    // Both orders are asked concurrently: call 1 = order 1, call 2 = order 2, call 3 = order 1's repair.
    const replies = ["no json", JSON.stringify(reply("2")), JSON.stringify(reply("1"))];
    const flaky: ChatClient = { id: "f", model: "f", complete: async () => replies.shift() ?? "" };
    await expect(judgePair(flaky, brief, GROUNDED, BASELINE, () => 0.1)).resolves.toMatchObject({ final: "grounded" });
    const broken: ChatClient = { id: "x", model: "x", complete: async () => JSON.stringify({ winner: "maybe" }) };
    await expect(judgePair(broken, brief, GROUNDED, BASELINE, () => 0.1)).rejects.toMatchObject({ name: "LLMOutputError" });
  });

  it("lets transport errors through untouched", async () => {
    const down: ChatClient = { id: "d", model: "d", complete: async () => Promise.reject(new Error("LLM 503 on /v1/messages")) };
    await expect(judgePair(down, brief, GROUNDED, BASELINE, () => 0.1)).rejects.toThrow(/503/);
  });
});

describe("ReplayChat", () => {
  it("records live replies and replays them with no live client", async () => {
    const live = { id: "live:m", model: "m", complete: vi.fn(async () => JSON.stringify(reply("1"))) };
    const recorder: Record<string, string> = {};
    const first = new ReplayChat("m", {}, live, recorder);
    const a = await first.complete("sys", "user");
    expect(live.complete).toHaveBeenCalledTimes(1);
    expect(recorder[completionKey("m", "sys", "user")]).toBe(a);
    const offline = new ReplayChat("m", recorder);
    expect(await offline.complete("sys", "user")).toBe(a);
    expect(offline.replayed).toBe(1);
    await expect(offline.complete("sys", "other")).rejects.toBeInstanceOf(NoRecordingError);
  });
  test.prop([fc.string(), fc.string(), fc.string(), fc.string()])("keys differ when any of model / system / user differ", (m, s, u, x) => {
    fc.pre(x !== u);
    expect(completionKey(m, s, u)).not.toBe(completionKey(m, s, x));
    expect(completionKey(m, s, u)).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("judge model selection", () => {
  it("uses JUDGE_* when set, falls back to LLM_*, and is absent when nothing is configured", () => {
    expect(judgeChatFromEnv({})).toBeUndefined();
    expect(judgeChatFromEnv({ LLM_PROVIDER: "anthropic", LLM_MODEL: "gen", LLM_API_KEY: "k" })?.id).toBe("anthropic:gen");
    expect(judgeChatFromEnv({ LLM_PROVIDER: "anthropic", LLM_MODEL: "gen", LLM_API_KEY: "k", JUDGE_PROVIDER: "openai", JUDGE_MODEL: "judge", JUDGE_API_KEY: "j" })?.id).toBe("openai:judge");
  });
  it("never sends the campaign model's key or host to a different judge provider", () => {
    const gen = { LLM_PROVIDER: "openai", LLM_MODEL: "gen", LLM_API_KEY: "sk-gen" };
    expect(judgeChatFromEnv({ ...gen, JUDGE_PROVIDER: "anthropic" })).toBeUndefined();
    expect(judgeChatFromEnv({ ...gen, JUDGE_PROVIDER: "anthropic", JUDGE_MODEL: "j" })).toBeUndefined();
    expect(judgeChatFromEnv({ ...gen, JUDGE_PROVIDER: "openai", JUDGE_MODEL: "j" })?.id).toBe("openai:j");
  });
  it("keeps an OpenAI-compatible host when the judge shares the provider", async () => {
    const f = vi.fn<typeof fetch>(async () => Response.json({ choices: [{ message: { content: "{}" } }] }));
    vi.stubGlobal("fetch", f);
    const judge = judgeChatFromEnv({ LLM_PROVIDER: "openai-compatible", LLM_MODEL: "gen", LLM_API_KEY: "k", LLM_BASE_URL: "https://groq.example/openai/v1", JUDGE_PROVIDER: "openai-compatible", JUDGE_MODEL: "j" });
    await judge?.complete("s", "u");
    expect(f.mock.calls[0]?.[0]).toEqual(expect.stringMatching(/^https:\/\/groq\.example\/openai\/v1\//));
  });
});

describe("summaries and the report", () => {
  const m = (picks: number, hallucinations: number, misses: number) => ({ picks, hallucinations, misses, fading: 0, cultureMissRate: 0 });
  const rowOf = (family: BenchRow["family"], sources = ["live"]): BenchRow => ({ subject: "s", family, grounded: m(10, 0, 1), baseline: m(10, 2, 5), sources, fallbacks: 0, qlooCalls: 50 });

  test.prop([fc.array(fc.record({ picks: fc.nat(30), hallucinations: fc.nat(10), misses: fc.nat(10), fading: fc.nat(5), cultureMissRate: fc.constant(0) }), { maxLength: 30 })])("totals add up and rates stay in [0, 1] when counts fit", (ms) => {
    fc.pre(ms.every((x) => x.hallucinations + x.misses + x.fading <= x.picks));
    const t = totals(ms);
    expect(t.picks).toBe(ms.reduce((a, x) => a + x.picks, 0));
    for (const r of [t.hallucinationRate, t.cultureMissRate, t.fadingRate]) {
      expect(r).toBeGreaterThanOrEqual(0);
      expect(r).toBeLessThanOrEqual(1);
    }
  });

  it("publishes no numbers for an invalid run, and says why", () => {
    const s = summarize([rowOf("music", ["simulated"])], { briefs: 1, model: "deterministic", modelScripted: true, ranAt: "t" });
    expect(s.valid).toBe(false);
    const md = renderReport(s);
    expect(md).toMatch(/No measurement yet/);
    expect(md).toMatch(/scripted offline model/);
    expect(md).not.toMatch(/\d+\.\d%/);
  });

  it("publishes the tables and the judge for a valid run, disclosing self-judging", () => {
    const js = [
      { firstShown: "grounded" as const, orders: [{ firstShown: "grounded" as const, reply: reply("1", 5, 2), outcome: "grounded" as const }, { firstShown: "baseline" as const, reply: reply("2", 2, 5), outcome: "grounded" as const }], final: "grounded" as const, consistent: true },
    ];
    const s = summarize([rowOf("music"), rowOf("dtc"), rowOf("sports")], {
      briefs: 3,
      model: "openai:gen",
      modelScripted: false,
      ranAt: "t",
      judge: { ...summarizeJudgements(js), model: "gen", sameAsGenerator: true, replayed: 0, live: 2, errors: [] },
    });
    expect(s.valid).toBe(true);
    expect(s.grounded.cultureMissRate).toBe(0.1);
    expect(s.judge?.meanScores.grounded.audienceFit).toBe(5);
    const md = renderReport(s);
    expect(md).toMatch(/\| Without Qloo \| 30 \| 20\.0% \| 70\.0% \|/);
    expect(md).toMatch(/self-preference possible/);
    expect(md).toMatch(/\| 1 \| 1 \| 0 \| 0 \| 0 \| 100\.0% \|/);
    expect(md).not.toMatch(/Incomplete/);
    const partial = renderReport({ ...s, judge: { ...must(s.judge), errors: ["Kaya: judge timed out"] } });
    expect(partial).toMatch(/\*\*Incomplete:\*\* 1 of 2 pairs could not be judged[\s\S]*- Kaya: judge timed out/);
  });

  it("marks partial or fallback runs invalid, and names what failed", () => {
    const failed = { ...rowOf("music"), subject: "Kaya", error: "No seed resolved" };
    const s = summarize([rowOf("music"), failed], { briefs: 2, model: "x", modelScripted: false, ranAt: "t" });
    expect(s.invalidReasons).toEqual(["1 of 2 briefs failed"]);
    expect(renderReport(s)).toMatch(/### Failed briefs\n\n- Kaya: No seed resolved/);
    expect(summarize([{ ...rowOf("music"), fallbacks: 3 }], { briefs: 1, model: "x", modelScripted: false, ranAt: "t" }).valid).toBe(false);
  });
});
