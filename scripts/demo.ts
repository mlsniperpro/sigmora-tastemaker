/** Run a preset end to end in the terminal: `pnpm demo [preset-id]`. */
import { runTastemaker } from "../src/lib/agent/run";
import { PRESETS, presetById } from "../src/lib/agent/presets";

const id = process.argv[2] ?? "indie-release";
const preset = presetById(id);
if (!preset) {
  console.error(`Unknown preset "${id}". Try: ${PRESETS.map((p) => p.id).join(", ")}`);
  process.exit(1);
}
const result = await runTastemaker(preset.brief);
for (const s of result.trace) {
  console.log(`${s.status === "done" ? "✓" : "✗"} ${s.title} (${s.ms}ms, ${s.calls.length} Qloo calls) — ${s.detail}`);
}
console.log(`\nQloo sources: ${result.sources.join(", ")} · LLM: ${result.llm.label}`);
// A cold run has an empty cache: with this (scripted) model, a live key spends at most the uncached count.
console.log(`Qloo requests: ${result.qloo.calls} (${result.qloo.calls - result.qloo.cached} uncached; a real model that names more entities makes more)`);
const fmt = (r: (typeof result.grounded.receipts)[number]) =>
  `  [${r.verdict.padEnd(13)}] ${r.role.padEnd(9)} ${r.name}${r.affinity !== undefined ? ` (${r.affinity.toFixed(2)})` : ""}${r.replaced ? `  ← replaced ${r.replaced.name}` : ""}`;
console.log("\nWith Qloo:");
result.grounded.receipts.forEach((r) => console.log(fmt(r)));
console.log("\nWithout Qloo (audited):");
result.baseline.receipts.forEach((r) => console.log(fmt(r)));
console.log("\nMetrics:", JSON.stringify(result.metrics));
console.log("\nHooks:", result.grounded.draft.hooks);
