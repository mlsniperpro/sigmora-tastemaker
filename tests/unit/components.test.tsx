/** Components rendered to HTML on the server: what a reader sees for each verdict and source. */
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { CampaignPack } from "@/components/CampaignPack";
import { ReceiptChip } from "@/components/Receipt";
import { Scoreboard } from "@/components/Scoreboard";
import { DEFAULT_CRITIC } from "@/lib/agent/context";
import { PRESETS } from "@/lib/agent/presets";
import { runTastemaker } from "@/lib/agent/run";
import type { Receipt, RunResult } from "@/lib/agent/types";
import { DeterministicLLM } from "@/lib/llm/deterministic";
import { Draft } from "@/lib/llm/types";
import { MemoryCache } from "@/lib/qloo/cache";
import { QlooClient } from "@/lib/qloo/client";

const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
const receipt = (o: Partial<Receipt>): Receipt => ({ name: "Tems", type: "artist", role: "collab", verdict: "pass", drivers: [], calls: [], note: "n", ...o });
const heroRun = () => runTastemaker(PRESETS[0].brief, { qloo: new QlooClient({ cache: new MemoryCache(), fixtures: {} }), llm: new DeterministicLLM() });

describe("Scoreboard", () => {
  it("shows no numbers for a simulated, scripted run, and says why", async () => {
    const html = text(renderToStaticMarkup(<Scoreboard result={await heroRun()} />));
    expect(html).not.toMatch(/\d+%/);
    expect(html).toMatch(/simulated Qloo data and a scripted stand-in model/);
  });
  it("shows the rates for a live run with a real model, and blanks the baseline when it failed", async () => {
    const r = await heroRun();
    const live: RunResult = { ...r, llm: { ...r.llm, scripted: false }, qloo: { ...r.qloo, live: r.qloo.calls, simulated: 0 } };
    const html = text(renderToStaticMarkup(<Scoreboard result={live} />));
    expect(html).toMatch(/\d+%.*\d+%/);
    // The after-critic rate is labelled as circular, with the bar the critic actually uses.
    expect(html).toContain(`the higher of ${DEFAULT_CRITIC.minAffinity} and ${DEFAULT_CRITIC.missRatio} × their median affinity`);
    expect(html).toMatch(/near zero by construction/);
    const noBase = text(renderToStaticMarkup(<Scoreboard result={{ ...live, baseline: { ...live.baseline, unavailable: "LLM 529" } }} />));
    expect(noBase).toMatch(/failed this run \(LLM 529\)/);
  });
});

describe("ReceiptChip", () => {
  it("never prints a number Qloo didn't give", () => {
    const html = text(renderToStaticMarkup(<ReceiptChip r={receipt({ verdict: "unscored" })} />));
    expect(html).toContain("No Qloo score");
    expect(html).not.toMatch(/affinity/);
  });
  it("labels names Qloo can't find, and shows the strongest driver for scored picks", () => {
    expect(text(renderToStaticMarkup(<ReceiptChip r={receipt({ verdict: "hallucination" })} />))).toContain("Not found in Qloo");
    const scored = text(renderToStaticMarkup(<ReceiptChip r={receipt({ affinity: 0.81, drivers: [{ name: "Rema", score: 0.2 }, { name: "Asake", score: 0.5 }] })} />));
    expect(scored).toMatch(/affinity 0\.81/);
    expect(scored).toMatch(/driven by Asake \(0\.50\)/);
  });
});

describe("CampaignPack highlighting", () => {
  const draft = Draft.parse({ positioning: "TEMS fans meet Temsy and Tems.", hooks: ["h"], script: "s", musicBrief: "m", captions: [{ platform: "X", text: "x" }], picks: [{ name: "Tems", type: "artist", role: "collab" }] });
  it("marks whole names in any case, never inside another word", () => {
    const html = renderToStaticMarkup(<CampaignPack side={{ draft, receipts: [receipt({ verdict: "miss", affinity: 0.1 })] }} mode="without" />);
    const struck = [...html.matchAll(/line-through[^>]*>([^<]+)</g)].map((m) => m[1]);
    expect(struck.filter((s) => s === "TEMS" || s === "Tems").length).toBeGreaterThanOrEqual(2);
    expect(struck).not.toContain("Temsy");
  });
  it("says so when the plan without Qloo couldn't be drafted", () => {
    const html = text(renderToStaticMarkup(<CampaignPack side={{ draft, receipts: [], unavailable: "LLM 529" }} mode="without" />));
    expect(html).toMatch(/failed on this run \(LLM 529\)/);
  });
});
