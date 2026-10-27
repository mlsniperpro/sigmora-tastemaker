/** Components rendered to HTML on the server: what a reader sees for each verdict and source. */
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { AuditPanel, AuditResults, SIMULATED_CATALOG_NOTE, audienceNames, auditInputProblem, auditSummary, friendlyAuditError } from "@/components/AuditPanel";
import { CampaignPack } from "@/components/CampaignPack";
import { ReceiptChip, TrendMark } from "@/components/Receipt";
import { TasteMap } from "@/components/TasteMap";
import { BriefForm, carriedOver, fieldsFromBrief, showsNewBrief } from "@/components/BriefForm";
import { callsLabel, callTally, Trace } from "@/components/Trace";
import { Brief } from "@/lib/agent/brief";
import { briefFromForm } from "@/lib/agent/briefForm";
import { auditPlan } from "@/lib/agent/audit";
import { metricsOf } from "@/lib/agent/critic";
import { AUDIT_SAMPLE, AUDIT_SAMPLE_AUDIENCE } from "@/lib/auditSample";
import { FADING_BELOW } from "@/lib/vocab";
import { must } from "../must";
import { RoiLine, RunError } from "@/components/App";
import { DiffCard, worstMisses } from "@/components/DiffCard";
import { SourceBanner } from "@/components/SourceBanner";
import { endSentence, followsDraft, initialRunState, parseServed, runReducer, streamRun, type RunAction, type RunState } from "@/components/useRun";
import { DEFAULT_CRITIC } from "@/lib/agent/context";
import { PRESETS } from "@/lib/agent/presets";
import { runTastemaker } from "@/lib/agent/run";
import type { Receipt, RunEvent, RunResult } from "@/lib/agent/types";
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
    // Why, in one line at the top (after the card's screen-reader-only heading): both sources named, and that the numbers are withheld.
    expect(html).toMatch(/^ ?With and without Qloo Simulated Qloo data · Scripted model\. No Qloo or LLM key on this deployment: .*not Qloo data.* so numbers are not shown\./);
    // No count and no "—" stand-in for one: the sides say what was checked.
    expect(html).not.toContain("—");
    expect(html).toMatch(/Same model, no Qloo 10 picks audited; counts not shown\./);
    expect(html).toMatch(/With the Qloo critic · shown below 10 picks after the critic; counts not shown\./);
    // The scripted baseline is one fixed plan per category, and says so.
    expect(html).toContain("Scripted stand-in: a fixed sample plan for this category, not a model's answer to your brief.");
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
    // A real model answered the brief: no scripted-baseline label, and no source line.
    expect(html).not.toContain("Scripted stand-in");
    expect(html).not.toMatch(/Simulated Qloo data|Scripted model/);
    const noBase = text(renderToStaticMarkup(<DiffCard result={{ ...live, baseline: { ...live.baseline, unavailable: "LLM 529" } }} mode="qloo" />));
    expect(noBase).toMatch(/isn.t available on this run \(LLM 529\)/);
  });
  it("calls the rate after the critic low by design only when it is low, and otherwise says what the critic left", async () => {
    const live = asLive(await heroRun(), true);
    const withRate = (cultureMissRate: number | null, hallucinations: number, misses: number): RunResult => ({
      ...live,
      metrics: { ...live.metrics, grounded: { ...live.metrics.grounded, judged: 10, hallucinations, misses, cultureMissRate } },
    });
    const card = (r: RunResult) => text(renderToStaticMarkup(<DiffCard result={r} mode="qloo" />));
    const low = card(withRate(0, 0, 0));
    expect(low).toContain("Miss Rate after the critic 0% (low by design)");
    expect(low).toContain("near zero by construction");
    // At the line (10%) it is still low; above it, neither phrase is used and the leftovers are counted.
    expect(card(withRate(0.1, 0, 1))).toContain("10% (low by design)");
    const high = card(withRate(0.2, 1, 1));
    expect(high).toContain("Miss Rate after the critic 20% (2 picks the critic couldn’t replace)");
    expect(high).toContain("it couldn’t replace 2 picks, so the rate after the critic is 20%, not near zero");
    expect(high).not.toMatch(/low by design|near zero by construction/);
    expect(card(withRate(0.1111, 1, 0))).toContain("(1 pick the critic couldn’t replace)");
    // Too few picks judged: no rate, and no claim about it either.
    const unknown = card(withRate(null, 0, 0));
    expect(unknown).toContain("Miss Rate after the critic —");
    expect(unknown).not.toMatch(/low by design|near zero|couldn’t replace/);
  });
});

describe("RoiLine", () => {
  it("counts no misses on a placeholder run and labels it simulated", async () => {
    const html = text(renderToStaticMarkup(<RoiLine result={await heroRun()} />));
    expect(html).not.toMatch(/would have shipped wrong/);
    expect(html).toMatch(/simulated Qloo calls/);
    expect(html).toMatch(/simulated: no miss count/);
  });
  it("withholds the duration on a simulated or scripted run and calls it an offline demo run", async () => {
    const run = await heroRun();
    const sim = text(renderToStaticMarkup(<RoiLine result={{ ...run, durationMs: 1000 }} />));
    expect(sim).toMatch(/^ ?Offline demo run with \d+ simulated Qloo calls, with \d+ cultural picks checked/);
    expect(sim).not.toMatch(/took|\d+ s\b/);
    // Live Qloo with the scripted model: the stand-in's speed is no better a measure of the product.
    const scripted = text(renderToStaticMarkup(<RoiLine result={{ ...asLive(run), llm: { ...run.llm, scripted: true }, durationMs: 1000 }} />));
    expect(scripted).toMatch(/Offline demo run with \d+ Qloo calls/);
    expect(scripted).not.toMatch(/took|\d+ s\b/);
  });
  it("states the measured miss count on a live run with a real model", async () => {
    const html = text(renderToStaticMarkup(<RoiLine result={asLive(await heroRun())} served={{ from: "cache" }} />));
    expect(html).toMatch(/\d+ of the plain model's picks would have shipped wrong/);
    expect(html).toMatch(/This plan took \d+ s \(when it first ran\)/);
    expect(html).not.toMatch(/Offline demo run/);
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
    expect(sim({ drivers: [{ name: "Asake", score: 0.5 }] })).not.toMatch(/\d\.\d|affinity|Passes the Qloo bar/);
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
  it("labels the scripted model's plan without Qloo as a fixed sample, not an answer to the brief", () => {
    const side = { draft, receipts: [receipt({ verdict: "miss", affinity: 0.1 })] };
    const label = "Scripted stand-in: a fixed sample plan for this category, not a model's answer to your brief.";
    expect(text(renderToStaticMarkup(<CampaignPack side={side} mode="without" scripted />))).toContain(label);
    expect(text(renderToStaticMarkup(<CampaignPack side={side} mode="without" />))).not.toContain("Scripted stand-in");
    // The plan with Qloo is the critic's output, so it isn't labelled.
    expect(text(renderToStaticMarkup(<CampaignPack side={side} mode="qloo" scripted />))).not.toContain("Scripted stand-in");
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
    expect(mark(FADING_BELOW + 0.5)).toBe("· steady −2.5%");
    expect(mark(-0.5)).toBe("· steady −0.5%");
    expect(mark(FADING_BELOW - 1.2)).toBe("↘ fading −4.2%");
    expect(mark(-FADING_BELOW + 1)).toBe("↗ rising +4.0%");
    // "→" means "replaced by" next to a pick (→ Victony), so no trend reading uses it.
    for (const t of [-9, FADING_BELOW, -0.5, 0, 0.5, 9]) expect(mark(t)).not.toContain("→");
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
    expect(html).not.toMatch(/\d\.\d\d|Not found in Qloo|Passes the Qloo bar|low-affinity/);
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
  it("checks the form in the browser, in words, before anything is sent", () => {
    const plan = "Collab targets: Ayra Starr, Victony. Venue: The Masquerade.";
    expect(auditInputProblem({ text: plan, names: " , " })).toEqual({ field: "names", message: "Name at least one artist or brand your audience loves." });
    expect(auditInputProblem({ text: plan, names: "" })?.field).toBe("names");
    expect(auditInputProblem({ text: "   too short    ", names: "Tems" })).toEqual({ field: "text", message: "Paste at least a sentence or two of the plan." });
    expect(auditInputProblem({ text: plan, names: "A, B, C, D, E, F" })).toEqual({ field: "names", message: "Name up to 5 artists or brands your audience loves (you gave 6)." });
    expect(auditInputProblem({ text: plan, names: "Tems, , Rema, Tems" })).toBeUndefined();
    expect(audienceNames("Tems, , Rema, Tems ")).toEqual(["Tems", "Rema"]);
  });
  it("never shows the server's schema text for a 400", () => {
    const schema = "seeds: Too small: expected array to have >=1 items";
    expect(friendlyAuditError(400, schema)).toBe("Name at least one artist or brand your audience loves.");
    expect(friendlyAuditError(400, "text: Paste at least a sentence or two of the plan")).toMatch(/^Paste at least/);
    expect(friendlyAuditError(400, "ages: Too small")).toMatch(/age range/);
    for (const e of [schema, "body: Unrecognized key: \"x\"", "Body must be JSON", undefined]) expect(friendlyAuditError(400, e)).not.toMatch(/Too small|expected|Unrecognized|body:/);
    // Other statuses already carry a sentence for people.
    expect(friendlyAuditError(422, "None of the audience's names resolved in Qloo; try other names they love.")).toMatch(/^None of the audience/);
    expect(friendlyAuditError(502)).toMatch(/The audit failed \(502\)/);
  });
  it("starts closed, with the sample one click away", () => {
    const html = renderToStaticMarkup(<AuditPanel seeds={["Tems"]} ages={["25_to_29"]} />);
    expect(html).toMatch(/aria-expanded="false"/);
    expect(html).toMatch(/hidden=""/);
    expect(text(html)).toContain("Audit any AI's plan");
    expect(text(html)).toContain("Try a sample plan");
  });
});

describe("SourceBanner", () => {
  it("says where the numbers came from in one line, naming each placeholder source", async () => {
    const run = await heroRun();
    const html = renderToStaticMarkup(<SourceBanner result={run} />);
    expect(html.match(/<p[ >]/g)).toHaveLength(1);
    expect(text(html).trim()).toMatch(/^Simulated Qloo data · Scripted model\. No Qloo or LLM key on this deployment: answers come from an offline simulator .*\(not Qloo data\) and drafts from a deterministic stand-in, so numbers are not shown\.$/);
    // Live Qloo with the scripted model: only the model is named, and only the miss counts are withheld.
    const liveQloo = { ...run, qloo: { ...run.qloo, live: run.qloo.calls, simulated: 0 } };
    expect(text(renderToStaticMarkup(<SourceBanner result={liveQloo} />)).trim()).toBe("Scripted model. No LLM key is set: drafts come from a deterministic stand-in, not a model, so miss counts are not shown.");
    // Replayed answers and a real model: the replay is counted, nothing is hidden.
    const replayed = { ...run, llm: { ...run.llm, scripted: false }, qloo: { ...run.qloo, replay: 70, live: run.qloo.calls - 70, simulated: 0 } };
    expect(text(renderToStaticMarkup(<SourceBanner result={replayed} />)).trim()).toBe(`Replayed Qloo responses. 70 of ${String(run.qloo.calls)} answers are recorded live hackathon API responses, served from fixtures.`);
    // All live with a real model: nothing to say.
    expect(renderToStaticMarkup(<SourceBanner result={asLive(run)} />)).toBe("");
  });
  it("says live Qloo failed, with the reason, when the preset was served from the simulator, and never blames a missing key", async () => {
    const run = await heroRun();
    const reason = "the live run failed (Qloo 503)";
    const banner = text(renderToStaticMarkup(<SourceBanner result={run} served={{ from: "simulated", reason }} />)).trim();
    // The reason is a sentence of its own after the main one (wording changed from a mid-sentence "shown because …").
    expect(banner).toBe(
      "Live Qloo unavailable · Simulated Qloo data · Scripted model. This is the preset on the offline simulator, with answers in Qloo's shapes (not Qloo data); drafts come from a deterministic stand-in, not a model, so numbers are not shown. Why: the live run failed (Qloo 503).",
    );
    expect(banner).not.toMatch(/No Qloo|key/);
    // A reason that already ends its sentence is not given a second full stop.
    const refused = "a new live run was refused (Today's Qloo budget can't cover another new run. Presets and cached runs still load; try a new brief tomorrow.)";
    expect(text(renderToStaticMarkup(<SourceBanner result={run} served={{ from: "simulated", reason: refused }} />)).trim()).toMatch(/not shown\. Why: a new live run was refused \(.*tomorrow\.\)$/);
    expect(text(renderToStaticMarkup(<SourceBanner result={run} served={{ from: "simulated", reason: "Qloo is down." }} />)).trim()).toMatch(/Why: Qloo is down\.$/);
    // With a real model only the Qloo half is named; without a reason it still says so.
    const real = text(renderToStaticMarkup(<SourceBanner result={{ ...run, llm: { ...run.llm, scripted: false } }} served={{ from: "simulated" }} />)).trim();
    expect(real).toBe("Live Qloo unavailable · Simulated Qloo data. This is the preset on the offline simulator, with answers in Qloo's shapes (not Qloo data), so numbers are not shown.");
    // The same run served any other way keeps the plain wording, and the diff card shows the note on top.
    expect(text(renderToStaticMarkup(<SourceBanner result={run} served={{ from: "cache" }} />))).toContain("No Qloo or LLM key on this deployment");
    expect(text(renderToStaticMarkup(<DiffCard result={run} mode="qloo" served={{ from: "simulated", reason }} />))).toContain("Live Qloo unavailable");
  });
});

describe("audit panel notes", () => {
  it("names the prose phrases not audited, the model's names not in the text, and cached results", async () => {
    const { extractionNote } = await import("@/components/AuditPanel");
    const base = { receipts: [], metrics: { picks: 0, judged: 0, hallucinations: 0, misses: 0, fading: 0, unscored: 0, cultureMissRate: null }, suggestions: [], sources: [], warnings: [], simulated: false };
    const note = extractionNote({ ...base, cached: true, extraction: { by: "scanner", capped: false, unmatched: ["Zorvana Blake", "Kelvin Quartz"] } });
    expect(note).toMatch(/Not audited, because no entity has that exact name: Zorvana Blake, Kelvin Quartz/);
    expect(note).toMatch(/identical earlier audit, so no Qloo calls were spent/);
    const known = extractionNote({ ...base, extraction: { by: "scanner", capped: false, otherTypes: [{ name: "Atlanta", type: "locality" }] } });
    expect(known).toMatch(/Known to the catalogue as a kind this audit doesn't check: Atlanta \(locality\)/);
    const model = extractionNote({ ...base, extraction: { by: "model", model: "m", capped: false, dropped: ["Taylor Swift"] } });
    expect(model).toMatch(/also listed Taylor Swift, which your text doesn't contain, so it wasn't audited/);
  });
});

describe("Trace header", () => {
  const header = (steps: RunResult["trace"]) => text(renderToStaticMarkup(<Trace steps={steps} running={false} pending={[]} collapsed setCollapsed={() => undefined} />));
  /** The trace with its first `only` calls (all of them by default) answered by `source`. */
  const asSource = (steps: RunResult["trace"], source: "live" | "simulated", only = Infinity): RunResult["trace"] => {
    let n = 0;
    return steps.map((s) => ({ ...s, calls: s.calls.map((c) => ({ ...c, source: n++ < only ? source : c.source })) }));
  };

  it("calls a simulated run's calls simulated, with the surfaces they exercised", async () => {
    const run = await heroRun();
    expect(run.qloo.simulated).toBeGreaterThan(0);
    const tally = callTally(run.trace);
    expect(tally.simulated).toBe(tally.calls);
    const html = header(run.trace);
    expect(html).toContain(`${String(tally.calls)} simulated calls · ${String(tally.surfaces)} Qloo surfaces exercised (simulated)`);
    expect(html).not.toMatch(/\d+ Qloo calls/);
    // The sticky bar uses the same label.
    expect(callsLabel(tally)).toBe(`${String(tally.calls)} simulated calls`);
  });
  it("keeps 'Qloo calls' for answers that came from Qloo, and says how many were simulated when only some were", async () => {
    const run = await heroRun();
    const live = asSource(run.trace, "live");
    const tally = callTally(live);
    expect(header(live)).toContain(`${String(tally.calls)} Qloo calls · ${String(tally.surfaces)} Qloo surfaces`);
    expect(header(live)).not.toMatch(/simulated/);
    const some = asSource(live, "simulated", 3);
    const mixed = callTally(some);
    expect(mixed.simulated).toBe(3);
    expect(callsLabel(mixed)).toBe(`${String(mixed.calls)} Qloo calls (3 simulated)`);
    expect(header(some)).not.toContain("exercised (simulated)");
  });
});

describe("audit results on a simulated result", () => {
  const audited = () => auditPlan({ text: AUDIT_SAMPLE, ...AUDIT_SAMPLE_AUDIENCE }, { qloo: new QlooClient({ cache: new MemoryCache(), fixtures: {} }), llm: new DeterministicLLM() });
  it("says above the results that the catalog is a small offline one, and not on Qloo data", async () => {
    const sim = await audited();
    const html = text(renderToStaticMarkup(<AuditResults result={sim} />));
    expect(html.trimStart()).toMatch(/^Offline demo catalog \(small\): famous names may be missing or judged by placeholder data\. A Qloo key gives real verdicts\./);
    expect(html.indexOf("Offline demo catalog")).toBeLessThan(html.indexOf("names found and checked"));
    // No catalog size it didn't count.
    expect(SIMULATED_CATALOG_NOTE).not.toMatch(/\d/);
    const live = { ...sim, simulated: false, receipts: sim.receipts.map((x) => ({ ...x, source: "live" as const })) };
    expect(text(renderToStaticMarkup(<AuditResults result={live} />))).not.toContain("Offline demo catalog");
  });
});

describe("BriefForm from the current run", () => {
  it("lays a brief back into the form's fields and reads it out again unchanged", () => {
    for (const p of PRESETS) {
      const back = briefFromForm(fieldsFromBrief(Brief.parse(p.brief)));
      expect(back).toMatchObject({ family: p.brief.family, subject: p.brief.subject, product: p.brief.product, seeds: p.brief.seeds, ages: p.brief.ages, goal: p.brief.goal });
      expect(back.targetCity).toBe(p.brief.targetCity);
      expect(back.compareTo).toBe(p.brief.compareTo);
      expect(back.vibe).toBe(p.brief.vibe);
    }
  });
  it("starts with the run's subject, seeds and link instead of empty fields", () => {
    const hero = Brief.parse(PRESETS[0].brief);
    const html = renderToStaticMarkup(<BriefForm busy={false} onRun={() => undefined} current={{ id: "abc", brief: hero }} />);
    expect(html).toContain(`value="${hero.subject}"`);
    expect(html).toContain(`value="${hero.seeds.join(", ")}"`);
    expect(html).toContain(`value="${hero.seedLinks[0] ?? ""}"`);
    // Ages are the run's, not the form's defaults.
    expect(html.match(/aria-pressed="true"/g)).toHaveLength(hero.ages.length);
    const empty = renderToStaticMarkup(<BriefForm busy={false} onRun={() => undefined} />);
    expect(empty).not.toContain(`value="${hero.subject}"`);
  });
  it("follows every new result, even one with the id of the last, and leaves an edit alone while the same result stays", () => {
    const hero = Brief.parse(PRESETS[0].brief);
    // A preset loaded again after a failed custom brief: same id, a new result object.
    expect(showsNewBrief(hero, Brief.parse(PRESETS[0].brief))).toBe(true);
    expect(showsNewBrief(undefined, hero)).toBe(true);
    // Re-rendering with the result already shown (the user typing, a run failing) changes nothing.
    expect(showsNewBrief(hero, hero)).toBe(false);
  });
});

describe("permalink and error helpers", () => {
  it("reads how a permalinked run was served, and falls back to the cache for anything else", () => {
    expect(parseServed({ from: "simulated", reason: "Qloo is down." })).toEqual({ from: "simulated", reason: "Qloo is down." });
    expect(parseServed({ from: "recording" })).toEqual({ from: "recording" });
    expect(parseServed({ from: "cache", reason: 7 })).toEqual({ from: "cache" });
    for (const bad of [undefined, null, "simulated", 3, {}, { from: "live" }, { reason: "x" }]) expect(parseServed(bad)).toEqual({ from: "cache" });
  });
  it("ends an error's sentence before the note about the previous result", () => {
    expect(endSentence("Qloo went away")).toBe("Qloo went away.");
    expect(endSentence("Qloo went away. ")).toBe("Qloo went away.");
    expect(endSentence("Is Qloo down?")).toBe("Is Qloo down?");
    expect(endSentence("Refused (try tomorrow.)")).toBe("Refused (try tomorrow.)");
    const withResult = text(renderToStaticMarkup(<RunError error="Qloo went away" hasResult />));
    expect(withResult).toBe(" Qloo went away. The previous result is still shown below. ");
    // Without a result on screen the message is shown as it came.
    expect(text(renderToStaticMarkup(<RunError error="Qloo went away" hasResult={false} />)).trim()).toBe("Qloo went away");
  });
});

describe("run state", () => {
  const hero = heroRun();
  const reduce = (s: RunState, ...actions: RunAction[]) => actions.reduce(runReducer, s);
  /** What the hook holds with a finished run on screen. */
  const onScreen = async (): Promise<RunState> =>
    reduce(initialRunState, { type: "begin" }, { type: "event", event: { type: "result", result: await hero } }, { type: "end" });
  /** Answers /api/run with a streamed body, or with a status and a JSON error like a refusal. */
  const respond = (body: string | { status: number; error: string }) => {
    const res = typeof body === "string" ? new Response(body) : Response.json({ error: body.error }, { status: body.status });
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(res)));
  };
  const ndjson = (...events: RunEvent[]) => events.map((e) => `${JSON.stringify(e)}\n`).join("");
  /** A new request from `before`, the way the hook drives it. */
  const request = async (before: RunState) => {
    let state = runReducer(before, { type: "begin" });
    const outcome = await streamRun({ preset: PRESETS[0].id }, new AbortController().signal, (a) => (state = runReducer(state, a)));
    return { state: runReducer(state, { type: "end" }), outcome };
  };

  it("keeps the result, trace and served label on screen when a new run is refused", async () => {
    const before = await onScreen();
    respond({ status: 429, error: "Your network has used today's share of the demo's Qloo budget." });
    const { state, outcome } = await request(before);
    expect(outcome).toBe("failed");
    expect(state.error).toMatch(/used today's share/);
    expect(state.result).toBe(before.result);
    expect(state.steps).toBe(before.steps);
    expect(state.served).toBe(before.served);
    expect(state.running).toBe(false);
    // The trace goes on showing the run on screen, not an empty one.
    expect(followsDraft(state)).toBe(false);
  });
  it("keeps the result when a new run fails after it has started streaming, and when it is cut off", async () => {
    const before = await onScreen();
    const step = must((await hero).trace[0]);
    respond(ndjson({ type: "start", id: step.id, title: step.title }, { type: "step", step }, { type: "error", message: "Qloo went away" }));
    const failed = await request(before);
    expect(failed.outcome).toBe("failed");
    expect(failed.state).toMatchObject({ error: "Qloo went away", result: before.result, steps: before.steps });
    respond(ndjson({ type: "step", step }));
    const cut = await request(before);
    expect(cut.state.error).toMatch(/cut off/);
    expect(cut.state.result).toBe(before.result);
  });
  it("shows the new run's progress in the trace while it streams, and the new result once it arrives", async () => {
    const before = await onScreen();
    const result = { ...(await hero), id: "newrun" };
    const step = must(result.trace[0]);
    let state = runReducer(before, { type: "begin" });
    expect(followsDraft(state)).toBe(false);
    state = reduce(state, { type: "event", event: { type: "start", id: step.id, title: step.title } });
    expect(followsDraft(state)).toBe(true);
    expect(state.result).toBe(before.result);
    state = reduce(state, { type: "event", event: { type: "step", step } }, { type: "event", event: { type: "result", result } }, { type: "end" });
    expect(state).toMatchObject({ result, steps: [step], error: undefined, running: false });
    expect(followsDraft(state)).toBe(false);
  });
  it("with nothing on screen yet, a failed run leaves the steps it got through for the trace", async () => {
    const step = must((await hero).trace[0]);
    respond(ndjson({ type: "step", step }, { type: "error", message: "boom" }));
    const { state } = await request(initialRunState);
    expect(state.result).toBeUndefined();
    expect(state.error).toBe("boom");
    // Through the wire, so undefined fields are gone.
    expect(state.steps).toEqual([JSON.parse(JSON.stringify(step))]);
  });
});

describe("BriefForm carried-over fields (audit 11)", () => {
  it("names the folded-away fields a prefilled brief still sends", async () => {
    const { PRESETS } = await import("@/lib/agent/presets");
    const { Brief } = await import("@/lib/agent/brief");
    const f = fieldsFromBrief(Brief.parse(PRESETS[PRESETS.length - 1]?.brief ?? PRESETS[0].brief));
    expect(carriedOver(f).length).toBeGreaterThan(0);
    expect(carriedOver({ ...f, product: "", goal: "", city: "", compareTo: "", vibe: "" })).toEqual([]);
  });
});
