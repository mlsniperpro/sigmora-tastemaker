/**
 * Cold hero-run latency against a stub that answers like the live host:
 * a fixed delay per Qloo call and the production 4 calls/s throttle.
 *
 *   pnpm bench:latency [delayMs=300] [repoRoot=.]
 *
 * Pass another checkout's root to compare two versions of the agent loop.
 */
import { resolve } from "node:path";

const delayMs = Number(process.argv[2] ?? 300);
const root = resolve(process.argv[3] ?? ".");
const load = <T>(p: string) => import(`${root}/src/lib/${p}.ts`) as Promise<T>;
const { runTastemaker } = await load<typeof import("../src/lib/agent/run")>("agent/run");
const { PRESETS } = await load<typeof import("../src/lib/agent/presets")>("agent/presets");
const { QlooClient } = await load<typeof import("../src/lib/qloo/client")>("qloo/client");
const { MemoryCache } = await load<typeof import("../src/lib/qloo/cache")>("qloo/cache");
const { Throttle } = await load<typeof import("../src/lib/qloo/throttle")>("qloo/throttle");
const { DeterministicLLM } = await load<typeof import("../src/lib/llm/deterministic")>("llm/deterministic");
const { simulate } = await load<typeof import("../src/lib/qloo/sim/simulator")>("qloo/sim/simulator");
type Path = Parameters<typeof simulate>[0];

const fetchImpl = async (url: URL) => {
  await new Promise((r) => setTimeout(r, delayMs));
  return Response.json(simulate(url.pathname as Path, Object.fromEntries(url.searchParams)));
};
const qloo = new QlooClient({ apiKey: "stub", cache: new MemoryCache(), fixtures: {}, fetchImpl: fetchImpl as unknown as typeof fetch, throttle: new Throttle(4, 4) });
const t0 = Date.now();
const r = await runTastemaker(PRESETS[0].brief, { qloo, llm: new DeterministicLLM() });
console.log(`${root}: hero preset, ${r.qloo.calls} Qloo calls at ${delayMs} ms each, 4/s → ${((Date.now() - t0) / 1000).toFixed(1)} s`);
