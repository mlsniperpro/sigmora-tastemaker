import { describe, it, expect } from "vitest";
import { fc, test } from "@fast-check/vitest";
import { Brief } from "@/lib/agent/brief";
import { PRESETS } from "@/lib/agent/presets";
import { MIN_IMPRESSIONS, requeryBrief, type PostPerformance } from "@/lib/agent/requery";
import type { Receipt, RunResult } from "@/lib/agent/types";
import { Draft } from "@/lib/llm/types";

const receipt = (name: string, verdict: Receipt["verdict"] = "pass", role: Receipt["role"] = "collab"): Receipt => ({ name, type: "artist", role, verdict, drivers: [], calls: [], note: "" });
const run = (captions: [string, string][], receipts: Receipt[]): Pick<RunResult, "brief" | "grounded"> => ({
  brief: Brief.parse(PRESETS[0].brief),
  grounded: {
    draft: Draft.parse({ positioning: "p", hooks: ["h"], script: "s", musicBrief: "m", picks: [{ name: "x", type: "artist", role: "collab" }], captions: captions.map(([platform, text]) => ({ platform, text })) }),
    receipts,
  } as RunResult["grounded"],
});
const RUN = run(
  [
    ["TikTok", "Ayra Starr fans, this one is for you"],
    ["X", "Out now. Pop-up at Echostage."],
    ["Instagram Reels", "With Victony on the remix"],
  ],
  [receipt("Ayra Starr"), receipt("Victony"), receipt("Echostage", "pass", "venue"), receipt("Nickelback", "miss")],
);
const TEXT: Record<string, string> = Object.fromEntries(RUN.grounded.draft.captions.map((c) => [c.platform, c.text]));
/** Measured posts by platform, with the text that went out. */
const perf = (rates: Record<string, number>, impressions = 1000): PostPerformance[] =>
  Object.entries(rates).map(([platform, r]) => ({ text: TEXT[platform] ?? "", impressions, engagements: Math.round(r * impressions) }));

describe("requeryBrief", () => {
  it("seeds the next run with verified picks from posts that beat the median", () => {
    const r = requeryBrief(RUN, perf({ TikTok: 0.09, X: 0.02, "Instagram Reels": 0.04 }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.winners).toEqual([{ name: "Ayra Starr", rate: 0.09, posts: 1 }]);
    expect(r.medianRate).toBe(0.04);
    expect(r.brief.seeds[0]).toBe("Ayra Starr");
    expect(r.brief.seeds).toEqual(expect.arrayContaining(PRESETS[0].brief.seeds.slice(0, 4)));
    expect(r.brief.preset).toBeUndefined();
    expect(Brief.safeParse(r.brief).success).toBe(true);
  });

  it("never seeds with venues, cities or picks that failed the critic", () => {
    const r = requeryBrief(RUN, perf({ TikTok: 0.01, X: 0.5, "Instagram Reels": 0.01 }));
    expect(r.ok).toBe(false);
  });

  it("refuses to rank without enough measured posts", () => {
    expect(requeryBrief(RUN, perf({ TikTok: 0.2 }))).toMatchObject({ ok: false, reason: expect.stringMatching(/at least 2 posts/) as unknown });
    expect(requeryBrief(RUN, perf({ TikTok: 0.2, X: 0.1 }, MIN_IMPRESSIONS - 1)).ok).toBe(false);
    expect(requeryBrief(RUN, perf({ Threads: 0.2, Bluesky: 0.1 })).ok).toBe(false);
  });

  it("attributes each measured post by its own text, even when two share a platform", () => {
    const posts = [
      { text: "Ayra Starr fans, this one is for you", impressions: 1000, engagements: 10 },
      { text: "With Victony on the remix", impressions: 1000, engagements: 120 },
      { text: "Out now.", impressions: 1000, engagements: 30 },
    ];
    const r = requeryBrief(RUN, posts);
    expect(r.ok && r.winners.map((w) => w.name)).toEqual(["Victony"]);
  });

  const rates = fc.record({ TikTok: fc.double({ min: 0, max: 1, noNaN: true }), X: fc.double({ min: 0, max: 1, noNaN: true }), "Instagram Reels": fc.double({ min: 0, max: 1, noNaN: true }) });
  test.prop([rates])("winners are verified picks above the median, and the brief stays valid", (r) => {
    const out = requeryBrief(RUN, perf(r));
    if (!out.ok) return;
    for (const w of out.winners) {
      expect(["Ayra Starr", "Victony"]).toContain(w.name);
      expect(w.rate).toBeGreaterThan(out.medianRate);
    }
    expect(out.brief.seeds.length).toBeLessThanOrEqual(5);
    expect(new Set(out.brief.seeds).size).toBe(out.brief.seeds.length);
    expect(Brief.safeParse(out.brief).success).toBe(true);
  });
});
