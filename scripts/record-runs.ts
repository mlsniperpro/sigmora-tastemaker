/**
 * Record one finished live run per preset into fixtures/runs/recorded.json, and
 * the audit panel's sample audit into fixtures/audits/recorded.json.
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
import { isHealthy } from "../src/lib/agent/runCache";
import type { RunResult } from "../src/lib/agent/types";
import { llmFromEnv } from "../src/lib/llm";
import { qlooFromEnv } from "../src/lib/qloo/client";
import { auditPlan } from "../src/lib/agent/audit";
import { AUDIT_SAMPLE, AUDIT_SAMPLE_AUDIENCE } from "../src/lib/auditSample";

const FILE = "fixtures/runs/recorded.json";
const AUDITS = "fixtures/audits/recorded.json";
const only = process.argv.slice(2);
const existing = JSON.parse(readFileSync(FILE, "utf8")) as Record<string, RunResult>;
const out: Record<string, RunResult> = { ...existing };
let failed = 0;

for (const preset of PRESETS.filter((p) => !only.length || only.includes(p.id))) {
  try {
    const r = await runTastemaker(preset.brief, { qloo: qlooFromEnv(), llm: llmFromEnv() });
    // What judges are shown first must be a whole run: no simulated or fallback data, no failed or skipped step, and no
    // pick a budget or time cut left unchecked (the same bar the run cache uses for serving a run as healthy).
    const unscored = r.metrics.grounded.unscored + r.metrics.baseline.unscored;
    const why =
      placeholderReason(r) ??
      (r.qloo.fallbacks.length ? `${r.qloo.fallbackCalls} Qloo calls fell back` : undefined) ??
      (r.trace.some((s) => s.status !== "done") ? "a step failed or was skipped" : undefined) ??
      (unscored ? `${String(unscored)} picks unscored (raise QLOO_RUN_CALL_CAP if the trace says the run's budget cut them)` : undefined);
    if (why || !isHealthy(r)) throw new Error(`not recorded: ${why ?? "not a healthy run"}`);
    out[preset.id] = r;
    console.log(`${preset.id.padEnd(14)} recorded ${r.id} · ${r.qloo.calls} Qloo calls · ${Math.round(r.durationMs / 1000)} s`);
  } catch (err) {
    failed++;
    console.error(`${preset.id.padEnd(14)} ${(err as Error).message}`);
  }
}
writeFileSync(FILE, JSON.stringify(out) + "\n");

// The audit panel's one-click sample, recorded the same way, so it still answers when a new audit is refused.
if (!only.length || only.includes("audit-sample")) {
  try {
    const audit = await auditPlan({ text: AUDIT_SAMPLE, ...AUDIT_SAMPLE_AUDIENCE }, { qloo: qlooFromEnv(), llm: llmFromEnv() });
    if (audit.simulated || audit.sources.some((x) => x !== "live")) throw new Error(`not recorded: Qloo answers came from ${audit.sources.join(", ")}`);
    if (audit.metrics.unscored || audit.warnings.length) throw new Error(`not recorded: ${String(audit.metrics.unscored)} unscored, warnings: ${audit.warnings.join("; ") || "none"}`);
    writeFileSync(AUDITS, JSON.stringify({ sample: audit }) + "\n");
    console.log(`audit-sample   recorded · ${String(audit.receipts.length)} names checked`);
  } catch (err) {
    failed++;
    console.error(`audit-sample   ${(err as Error).message}`);
  }
}
if (failed) process.exitCode = 1;
