/**
 * Record live Qloo responses for every preset into fixtures/qloo/recorded.json,
 * then run the live probes listed in BLOCKED.md.
 *
 *   QLOO_API_KEY=… pnpm fixtures:record
 *
 * Refuses to run without a key. Never writes the key anywhere: fixture keys
 * are normalized request paths.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { PRESETS } from "../src/lib/agent/presets";
import { runTastemaker } from "../src/lib/agent/run";
import { DeterministicLLM } from "../src/lib/llm/deterministic";
import { MemoryCache } from "../src/lib/qloo/cache";
import { QlooClient } from "../src/lib/qloo/client";
import { Throttle } from "../src/lib/qloo/throttle";

const key = process.env.QLOO_API_KEY;
if (!key) {
  console.error("QLOO_API_KEY is not set; nothing to record.");
  process.exit(1);
}

const file = join(process.cwd(), "fixtures/qloo/recorded.json");
const existing = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
const recorder: Record<string, unknown> = {};
// The hackathon key allows ~5 requests/second; stay under it.
const qloo = new QlooClient({ apiKey: key, baseUrl: process.env.QLOO_BASE_URL, mode: "live", cache: new MemoryCache(5000), fixtures: {}, recorder, throttle: new Throttle(4, 4) });

let failures = 0;
for (const p of PRESETS) {
  try {
    // The scripted LLM is enough: we are recording Qloo, and its picks are a fixed set.
    const r = await runTastemaker(p.brief, { qloo, llm: new DeterministicLLM() });
    const empty = r.trace.filter((s) => s.status === "error").map((s) => `${s.id}: ${s.detail}`);
    console.log(`✓ ${p.id}: ${r.trace.reduce((n, s) => n + s.calls.length, 0)} calls; failed steps: ${empty.join(" | ") || "none"}`);
    if (!r.cities.length && !p.brief.targetCity) console.warn(`  ! ${p.id}: no metro ranking — check the nationwide urn:heatmap call and that /search locality hits carry location.lat/lon (BLOCKED #8)`);
    if (!r.heatmap.length && !p.brief.targetCity) console.warn(`  ! ${p.id}: empty heatmap — check heatmap params`);
  } catch (err) {
    failures++;
    console.error(`✗ ${p.id}: ${(err as Error).message}`);
  }
}

// Probes: coverage and parameter questions from BLOCKED.md.
const spotifyProbe = process.env.PROBE_SPOTIFY_ID;
const probes: [string, () => Promise<unknown>][] = [
  ["Nairobi locality search", () => qloo.search("Nairobi", ["locality"], 3)],
  ["Nairobi places", () => qloo.insights("urn:entity:place", { "filter.location.query": "Nairobi", take: 5 })],
  // Set PROBE_SPOTIFY_ID to a real Spotify artist id to check /entities external-ID lookup.
  ...(spotifyProbe ? ([["Spotify external id", () => qloo.entitiesByExternal("spotify", [spotifyProbe])]] as [string, () => Promise<unknown>][]) : []),
  ["Tags semantic search", () => qloo.tags("afrobeats", 5)],
];
for (const [name, fn] of probes) {
  try {
    const r = (await fn()) as { data: unknown };
    console.log(`probe ${name}: ${JSON.stringify(r.data).slice(0, 200)}`);
  } catch (err) {
    console.log(`probe ${name}: FAILED ${(err as Error).message}`);
  }
}

writeFileSync(file, JSON.stringify({ ...existing, ...recorder }, null, 1) + "\n");
console.log(`Wrote ${Object.keys(recorder).length} responses to ${file}`);

// The same check as tests/integration/committed-recordings.test.ts: every preset must replay from the recordings
// alone. A call that failed live was never recorded, and would fail that test after the commit.
const missing = new Set<string>();
for (const p of PRESETS) {
  const replay = new QlooClient({ cache: new MemoryCache(5000), fixtures: { ...existing, ...recorder } });
  replay.observe((m) => {
    if (m.source !== "replay") missing.add(m.key);
  });
  const r = await runTastemaker(p.brief, { qloo: replay, llm: new DeterministicLLM() });
  if (r.trace.some((s) => s.status !== "done")) failures++;
}
if (missing.size) {
  failures++;
  console.error(`✗ ${missing.size} request(s) have no recording (a live call failed); fix or re-run before committing:\n  ${[...missing].join("\n  ")}`);
}
process.exit(failures ? 1 : 0);
