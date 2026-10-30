/**
 * Record live Qloo responses for every preset into fixtures/qloo/recorded.json,
 * then run the live probes listed in BLOCKED.md.
 *
 *   QLOO_API_KEY=… pnpm fixtures:record
 *
 * Refuses to run without a key. Never writes the key anywhere: fixture keys
 * are normalized request paths.
 */
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
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
// The hackathon key allows ~5 requests/second; stay under it. Some place insights take 13 s+ live, past the
// demo's 12 s timeout; a recording has no visitor waiting, so it waits longer rather than miss them.
const qloo = new QlooClient({
  apiKey: key,
  baseUrl: process.env.QLOO_BASE_URL,
  mode: "live",
  cache: new MemoryCache(5000),
  fixtures: {},
  recorder,
  throttle: new Throttle(4, 4),
  timeoutMs: 30_000,
});

let failures = 0;
for (const p of PRESETS) {
  try {
    // The scripted LLM is enough: we are recording Qloo, and its picks are a fixed set.
    // No visitor is waiting: lift the run and Qloo deadlines, so a slow Qloo phase records every call the replay will ask for.
    const r = await runTastemaker(p.brief, { qloo, llm: new DeterministicLLM(), deadlineMs: 600_000, qlooDeadlineMs: 540_000, reviseDeadlineMs: 300_000 });
    const empty = r.trace.filter((s) => s.status === "error").map((s) => `${s.id}: ${s.detail}`);
    console.log(`✓ ${p.id}: ${r.trace.reduce((n, s) => n + s.calls.length, 0)} calls; failed steps: ${empty.join(" | ") || "none"}`);
    // An empty ranking leaves the trace step "done", so it is checked here: it would ship a launch city Qloo never placed.
    if (!r.cities.length && !p.brief.targetCity) {
      failures++;
      console.error(`✗ ${p.id}: no metro ranking — check the nationwide urn:heatmap call and that /search locality hits carry location.lat/lon or lat/lng (BLOCKED #8)`);
    }
    if (!r.heatmap.length) {
      failures++;
      console.error(`✗ ${p.id}: empty heatmap — check the heatmap params${p.brief.targetCity ? ` (filter.location.query=${p.brief.targetCity} + radius=0, BLOCKED #22)` : ""}`);
    }
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

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const pick = (o: Record<string, unknown>, keys: readonly string[]) => Object.fromEntries(keys.filter((k) => k in o).map((k) => [k, o[k]]));

/**
 * What the app never reads, dropped before the recording is written. Live heatmaps ignore `take` and return
 * ~15,000 cells, each with a dozen per-signal ranks; entities carry tag lists and locality boundary polygons.
 * Neither is read anywhere in src/; the presets replay identically from the slim file, which is ~10 MB instead of ~36 MB.
 */
function slimEntity(e: unknown): unknown {
  if (!isObj(e)) return e;
  const out = { ...e };
  delete out.tags;
  if (isObj(out.properties)) {
    const properties = { ...out.properties };
    delete properties.boundaries;
    out.properties = properties;
  }
  return out;
}
function slim(reply: unknown): unknown {
  if (!isObj(reply)) return reply;
  const results = reply.results;
  if (Array.isArray(results)) return { ...reply, results: results.map(slimEntity) };
  if (!isObj(results)) return reply;
  const out: Record<string, unknown> = { ...results };
  if (Array.isArray(results.entities)) out.entities = results.entities.map(slimEntity);
  if (Array.isArray(results.heatmap)) {
    out.heatmap = (results.heatmap as unknown[]).map((c) =>
      isObj(c) ? { location: isObj(c.location) ? pick(c.location, ["latitude", "longitude", "geohash", "name", "entity_id"]) : c.location, query: isObj(c.query) ? pick(c.query, ["affinity", "affinity_rank", "popularity"]) : c.query } : c,
    );
  }
  return { ...reply, results: out };
}

const merged = Object.fromEntries(Object.entries({ ...existing, ...recorder }).map(([k, v]) => [k, slim(v)]));

// The same check as tests/integration/committed-recordings.test.ts: every preset must replay from the recordings
// alone. A call that failed live was never recorded, and would fail that test after the commit.
const missing = new Set<string>();
for (const p of PRESETS) {
  const replay = new QlooClient({ cache: new MemoryCache(5000), fixtures: merged });
  replay.observe((m) => {
    if (m.source !== "replay") missing.add(m.key);
  });
  const r = await runTastemaker(p.brief, { qloo: replay, llm: new DeterministicLLM() });
  const notDone = r.trace.filter((s) => s.status !== "done").map((s) => `${s.id}: ${s.detail}`);
  if (notDone.length) {
    failures++;
    console.error(`✗ ${p.id} replay: ${notDone.join(" | ")}`);
  }
}
if (missing.size) {
  failures++;
  console.error(`✗ ${missing.size} request(s) have no recording (a live call failed); fix or re-run before committing:\n  ${[...missing].join("\n  ")}`);
}
// Checked before writing, so a failed re-record never replaces a good committed recording.
if (failures) {
  const kept = join(mkdtempSync(join(tmpdir(), "tastemaker-recorded-")), "recorded.json");
  writeFileSync(kept, JSON.stringify(merged) + "\n");
  console.error(`✗ ${file} left unchanged; this attempt's ${Object.keys(recorder).length} responses are in ${kept} for inspection`);
  process.exit(1);
}
writeFileSync(file, JSON.stringify(merged) + "\n");
console.log(`Wrote ${Object.keys(recorder).length} responses to ${file}`);
