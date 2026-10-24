/**
 * Record one finished live run per preset into fixtures/runs/recorded.json.
 *
 *   QLOO_API_KEY=… LLM_PROVIDER=… LLM_MODEL=… LLM_API_KEY=… pnpm runs:record
 *
 * The demo serves these instantly (labelled "a recorded live run"), offers
 * "Re-run live", and falls back to them when a live run is refused or fails,
 * so the hosted demo survives rate limits and key outages during judging.
 * Refuses to record simulated Qloo data or the scripted model: a recording
 * must be real.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { PRESETS } from "../src/lib/agent/presets";
import { placeholderReason } from "../src/lib/agent/evidence";
import { runTastemaker } from "../src/lib/agent/run";
import type { RunResult } from "../src/lib/agent/types";
import { llmFromEnv } from "../src/lib/llm";
import { qlooFromEnv } from "../src/lib/qloo/client";

const FILE = "fixtures/runs/recorded.json";
const only = process.argv.slice(2);
const existing = JSON.parse(readFileSync(FILE, "utf8")) as Record<string, RunResult>;
const out: Record<string, RunResult> = { ...existing };
let failed = 0;

for (const preset of PRESETS.filter((p) => !only.length || only.includes(p.id))) {
  try {
    const r = await runTastemaker(preset.brief, { qloo: qlooFromEnv(), llm: llmFromEnv() });
    const why = placeholderReason(r) ?? (r.qloo.fallbacks.length ? `${r.qloo.fallbackCalls} Qloo calls fell back` : undefined) ?? (r.trace.some((s) => s.status === "error") ? "a step failed" : undefined);
    if (why) throw new Error(`not recorded: ${why}`);
    out[preset.id] = r;
    console.log(`${preset.id.padEnd(14)} recorded ${r.id} · ${r.qloo.calls} Qloo calls · ${Math.round(r.durationMs / 1000)} s`);
  } catch (err) {
    failed++;
    console.error(`${preset.id.padEnd(14)} ${(err as Error).message}`);
  }
}
writeFileSync(FILE, JSON.stringify(out) + "\n");
if (failed) process.exitCode = 1;
