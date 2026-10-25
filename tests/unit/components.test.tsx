/** Components rendered to HTML on the server: what a reader sees for each verdict and source. */
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { AuditPanel, AuditResults, auditSummary } from "@/components/AuditPanel";
import { CampaignPack } from "@/components/CampaignPack";
import { ReceiptChip, TrendMark } from "@/components/Receipt";
import { TasteMap } from "@/components/TasteMap";
import { Trace } from "@/components/Trace";
import { auditPlan } from "@/lib/agent/audit";
import { metricsOf } from "@/lib/agent/critic";
import { AUDIT_SAMPLE, AUDIT_SAMPLE_AUDIENCE } from "@/lib/auditSample";
import { FADING_BELOW } from "@/lib/vocab";
import { must } from "../must";
import { RoiLine } from "@/components/App";
import { DiffCard, worstMisses } from "@/components/DiffCard";
import { DEFAULT_CRITIC } from "@/lib/agent/context";
import { PRESETS } from "@/lib/agent/presets";
import { runTastemaker } from "@/lib/agent/run";
import type { Receipt, RunResult } from "@/lib/agent/types";
import { DeterministicLLM } from "@/lib/llm/deterministic";
import { Draft } from "@/lib/llm/types";
import { MemoryCache } from "@/lib/qloo/cache";
import { QlooClient } from "@/lib/qloo/client";

const text = (html: string) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, "&");
const receipt = (o: Partial<Receipt>): Receipt => ({ name: "Tems", type: "artist", role: "collab", verdict: "pass", drivers: [], calls: [], note: "n", ...o });
const heroRun = () => runTastemaker(PRESETS[0].brief, { qloo: new QlooClient({ cache: new MemoryCache(), fixtures: {} }), llm: new DeterministicLLM() });

/** The run as if Qloo had answered live and a real model had drafted it (receipts keep their own sources unless `relabel`). */
const asLive = (r: RunResult, relabel = false): RunResult => ({
  ...r,
  llm: { ...r.llm, scripted: false },
  qloo: { ...r.qloo, live: r.qloo.calls, simulated: 0 },
  ...(relabel ? { baseline: { ...r.baseline, receipts: r.baseline.receipts.map((x) => ({ ...x, source: "live" as const })) } } : {}),
});

describe("DiffCard", () => {
  it("shows no numbers for a simulated, scripted run, says why, and labels its verdicts simulated", async () => {
    const html = text(renderToStaticMarkup(<DiffCard result={await heroRun()} mode="qloo" />));
    expect(html).not.toMatch(/\d+%/);
    expect(html).not.toMatch(/\d\.\d\d/);
    expect(html).toMatch(/simulated Qloo data and a scripted stand-in model/);
    expect(html).toMatch(/Same model, no Qloo — of 10 picks flagged/);
    expect(html).toContain("Simulated: not in catalog");
    expect(html).not.toContain("Not found in Qloo");
  });
  it("counts the run's own receipts for a live run with a real model, and blanks the baseline when it failed", async () => {
    const live = asLive(await heroRun(), true);
    const b = live.metrics.baseline;
    const html = text(renderToStaticMarkup(<DiffCard result={live} mode="without" />));
    expect(html).toContain(`${b.hallucinations} invented · ${b.misses} low-affinity · ${b.fading} fading`);
    expect(html).toContain(`${b.hallucinations + b.misses + b.fading} of ${b.picks} picks flagged`);
    expect(html).toMatch(/\d+%.*\d+%/);
    // The worst misses carry their own notes, names Qloo can't find first.
    const worst = worstMisses(live.baseline.receipts);
    expect(worst).toHaveLength(3);
    expect(worst[0]?.verdict).toBe("hallucination");
    for (const w of worst) expect(html).toContain(w.note);
    // The after-critic rate is labelled as circular, with the bar the critic actually uses.
    expect(html).toContain(`the higher of ${DEFAULT_CRITIC.minAffinity} and ${DEFAULT_CRITIC.missRatio} × their median affinity`);
    expect(html).toMatch(/near zero by construction/);
    const noBase = text(renderToStaticMarkup(<DiffCard result={{ ...live, baseline: { ...live.baseline, unavailable: "LLM 529" } }} mode="qloo" />));
    expect(noBase).toMatch(/isn.t available on this run \(LLM 529\)/);
  });
});

describe("RoiLine", () => {
  it("counts no misses on a placeholder run and labels it simulated", async () => {
    const html = text(renderToStaticMarkup(<RoiLine result={await heroRun()} />));
    expect(html).not.toMatch(/would have shipped wrong/);
    expect(html).toMatch(/simulated Qloo calls/);
    expect(html).toMatch(/simulated: no miss count/);
  });
  it("states the measured miss count on a live run with a real model", async () => {
    const html = text(renderToStaticMarkup(<RoiLine result={asLive(await heroRun())} served={{ from: "cache" }} />));
    expect(html).toMatch(/\d+ of the plain model's picks would have shipped wrong/);
    expect(html).toMatch(/\(when it first ran\)/);
    expect(html).not.toMatch(/simulated/);
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
  it("labels simulated verdicts as simulated and prints none of the simulator's numbers", () => {
    const sim = (o: Partial<Receipt>) => text(renderToStaticMarkup(<ReceiptChip r={receipt({ source: "simulated", affinity: 0.87, threshold: 0.5, ...o })} />));
    expect(sim({})).toContain("Simulated pass");
    expect(sim({ verdict: "miss" })).toContain("Simulated miss");
    expect(sim({ verdict: "hallucination", affinity: undefined })).toContain("Simulated: not in catalog");
    expect(sim({ drivers: [{ name: "Asake", score: 0.5 }] })).not.toMatch(/\d\.\d|affinity|Qloo-verified/);
    // A receipt with no source of its own takes the run's.
    expect(text(renderToStaticMarkup(<ReceiptChip r={receipt({ affinity: 0.6 })} runSimulated />))).toContain("Simulated pass");
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
    expect(html).toMatch(/isn.t available on this run \(LLM 529\)/);
  });
});

describe("TasteMap", () => {
  it("draws shapes and ranks with no numeric labels on simulated data, under the simulated badge", async () => {
    const run = await heroRun();
    expect(run.audience.age.length).toBeGreaterThan(0);
    expect(run.cities.length).toBeGreaterThan(0);
    const html = renderToStaticMarkup(<TasteMap result={run} />);
    const shown = text(html);
    // What a reader can see: the text (SVG <title>s included) and every tooltip; not geometry or bar widths.
    const readable = `${shown} ${[...html.matchAll(/title="([^"]*)"/g)].map((m) => m[1]).join(" ")}`;
    expect(shown).toContain("simulated data, not Qloo");
    expect(shown).toMatch(/values hidden/);
    // No affinity, over-index or explainability value anywhere, tooltips included.
    expect(readable).not.toMatch(/\d\.\d\d/);
    expect(readable).not.toMatch(/[+−]\d/);
    expect(readable).not.toMatch(/affinity \d|explainability \d/);
    // The shapes and the rank order are still there: bars, the numbered metros, the web.
    expect(html).toMatch(/bg-violet/);
    expect(shown).toContain(`1 ${must(run.cities[0], "top city").name}`);
    expect(html).toContain("Cross-domain affinity web");
  });
  it("labels every value on Qloo data", async () => {
    const live = asLive(await heroRun());
    const shown = text(renderToStaticMarkup(<TasteMap result={live} />));
    expect(shown).not.toContain("simulated data, not Qloo");
    expect(shown).toContain(must(live.cities[0], "top city").affinity.toFixed(2));
    expect(shown).toContain(must(live.audience.tags[0], "a tag").affinity.toFixed(2));
    expect(shown).toMatch(/[+-]\d+ /);
  });
});

describe("TrendMark", () => {
  const mark = (trend: number, simulated = false) => text(renderToStaticMarkup(<TrendMark trend={trend} simulated={simulated} />)).trim();
  it("uses the critic's fading bar and shows the reading as a percent change", () => {
    expect(FADING_BELOW).toBe(DEFAULT_CRITIC.fadingBelow);
    // Just above the bar: steady, not cooling (the old chip called anything under -0.1 cooling).
    expect(mark(FADING_BELOW + 0.5)).toBe("→ steady −2.5%");
    expect(mark(-0.5)).toBe("→ steady −0.5%");
    expect(mark(FADING_BELOW - 1.2)).toBe("↘ fading −4.2%");
    expect(mark(-FADING_BELOW + 1)).toBe("↗ rising +4.0%");
    const html = renderToStaticMarkup(<TrendMark trend={-4.2} simulated={false} />);
    expect(html).toMatch(/population_percent_delta: −4\.2%; the critic marks a pick fading below −3\.0%/);
    expect(html).not.toMatch(/velocity/);
  });
  it("gives the direction only on simulated data", () => {
    expect(mark(-4.2, true)).toBe("↘ fading");
    expect(renderToStaticMarkup(<TrendMark trend={-4.2} simulated />)).not.toMatch(/4\.2/);
  });
});

describe("Trace re-run", () => {
  const trace = (rerunLive: boolean) =>
    text(
      renderToStaticMarkup(
        <Trace steps={[]} running={false} pending={[]} served={{ from: "recording", at: "2026-10-25T08:00:00Z" }} onRerun={() => undefined} rerunLive={rerunLive} collapsed={false} setCollapsed={() => undefined} />,
      ),
    );
  it("says live only when the re-run calls live Qloo", () => {
    expect(trace(true)).toContain("Re-run live");
    expect(trace(false)).toContain("Re-run");
    expect(trace(false)).not.toContain("Re-run live");
  });
});

describe("AuditResults", () => {
  const audited = () => auditPlan({ text: AUDIT_SAMPLE, ...AUDIT_SAMPLE_AUDIENCE }, { qloo: new QlooClient({ cache: new MemoryCache(), fixtures: {} }), llm: new DeterministicLLM() });
  it("shows every name with the simulated chip and no numbers on simulated data", async () => {
    const html = text(renderToStaticMarkup(<AuditResults result={await audited()} />));
    expect(html).toContain("simulated data, not Qloo");
    expect(html).toMatch(/\d+ names found and checked by the offline simulator/);
    expect(html).toContain("Kemi Adebayo-Rhodes");
    expect(html).toContain("Simulated: not in catalog");
    expect(html).toContain("(the simulator's pick)");
    expect(html).not.toMatch(/\d\.\d\d|Not found in Qloo|Qloo-verified|low-affinity/);
    expect(html).toMatch(/deterministic scanner/);
  });
  it("counts verdicts and prints Qloo's numbers on Qloo data", async () => {
    const sim = await audited();
    const r = { ...sim, simulated: false, receipts: sim.receipts.map((x) => ({ ...x, source: "live" as const })) };
    const html = text(renderToStaticMarkup(<AuditResults result={r} />));
    expect(html).toContain(`checked by Qloo: ${String(r.metrics.hallucinations)} not found in Qloo · ${String(r.metrics.misses)} low-affinity`);
    expect(html).toContain("Not found in Qloo");
    expect(html).toMatch(/affinity \d\.\d\d/);
    expect(html).toContain("(Qloo's pick)");
    expect(html).not.toContain("simulated data, not Qloo");
  });
  it("explains an audit that found no names", () => {
    expect(auditSummary({ receipts: [], metrics: metricsOf([]), simulated: true })).toMatch(/No cultural names found/);
  });
  it("starts closed, with the sample one click away", () => {
    const html = renderToStaticMarkup(<AuditPanel seeds={["Tems"]} ages={["25_to_29"]} />);
    expect(html).toMatch(/aria-expanded="false"/);
    expect(html).toMatch(/hidden=""/);
    expect(text(html)).toContain("Audit any AI's plan");
    expect(text(html)).toContain("Try a sample plan");
  });
});
