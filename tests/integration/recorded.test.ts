/** Recorded preset runs, single-flight runs and run permalinks, through the real routes. */
import { describe, expect, it, vi } from "vitest";
import { GET as getRun, POST as postRun } from "@/app/api/run/route";
import { Brief } from "@/lib/agent/brief";
import { PRESETS } from "@/lib/agent/presets";
import { cachedRun, getOrRun, recordedRuns } from "@/lib/agent/runCache";
import type { RunEvent, RunResult } from "@/lib/agent/types";
import { DeterministicLLM } from "@/lib/llm/deterministic";
import type { Draft, DraftInput } from "@/lib/llm/types";
import { MemoryCache } from "@/lib/qloo/cache";
import { QlooClient } from "@/lib/qloo/client";
import { must } from "../must";

// A recorded run of the hero preset, as `pnpm runs:record` would write it (here from the offline stack).
vi.mock("../../fixtures/runs/recorded.json", async () => {
  const { runTastemaker } = await import("@/lib/agent/run");
  const { PRESETS: presets } = await import("@/lib/agent/presets");
  const { MemoryCache: Cache } = await import("@/lib/qloo/cache");
  const { QlooClient: Client } = await import("@/lib/qloo/client");
  const { DeterministicLLM: Llm } = await import("@/lib/llm/deterministic");
  const hero = await runTastemaker(presets[0].brief, { qloo: new Client({ cache: new Cache(), fixtures: {} }), llm: new Llm(), newId: () => "recordedhero1" });
  return { default: { [presets[0].id]: hero, "not-a-run": { junk: true } } };
});

const post = (body: unknown, ip = "7.7.7.7") => new Request("http://x/api/run", { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": ip }, body: JSON.stringify(body) });
async function events(res: Response): Promise<RunEvent[]> {
  return (await res.text()).trim().split("\n").map((l) => JSON.parse(l) as RunEvent);
}
const resultEvent = (ev: RunEvent[]) => ev.find((e): e is Extract<RunEvent, { type: "result" }> => e.type === "result");

class SlowCountingLLM extends DeterministicLLM {
  drafts = 0;
  override async draft(input: DraftInput): Promise<Draft> {
    this.drafts++;
    await new Promise((r) => setTimeout(r, 20));
    return super.draft(input);
  }
}
class FailingLLM extends DeterministicLLM {
  override async draft(): Promise<Draft> {
    throw new Error("LLM 401");
  }
}

describe("recorded preset runs", () => {
  it("loads only valid current-schema recordings", () => {
    const runs = recordedRuns();
    expect([...runs.keys()]).toEqual([PRESETS[0].id]);
  });

  it("serves a preset's recording instantly, labelled, without spending anything", async () => {
    const res = await postRun(post({ preset: PRESETS[0].id }));
    expect(res.headers.get("x-run-cache")).toBe("recording");
    const r = must(resultEvent(await events(res)));
    expect(r.result.id).toBe("recordedhero1");
    expect(r.served).toEqual({ from: "recording" });
  });

  it("runs live when asked (fresh), and falls back to the recording, with the reason, when the live run fails", async () => {
    const fresh = await postRun(post({ preset: PRESETS[0].id, fresh: true }));
    expect(fresh.headers.get("x-run-cache")).not.toBe("recording");
    expect(must(resultEvent(await events(fresh))).served).toBeUndefined();

    const recording = must(recordedRuns().get(PRESETS[0].id));
    const lookup = await cachedRun(Brief.parse(PRESETS[0].brief), { qloo: new QlooClient({ cache: new MemoryCache(), fixtures: {} }), llm: new FailingLLM(), cache: new MemoryCache() });
    const seen: RunEvent[] = [];
    const out = await getOrRun(lookup, (e) => seen.push(e), recording);
    expect(out.result.id).toBe("recordedhero1");
    expect(out.served).toMatchObject({ from: "recording", reason: expect.stringMatching(/live run failed \(LLM 401\)/) as unknown });
    expect(resultEvent(seen)?.served?.from).toBe("recording");
  });

  it("opens any run by id, recordings included, and 404s an unknown one", async () => {
    const res = await getRun(new Request("http://x/api/run?id=recordedhero1"));
    expect(((await res.json()) as { result: RunResult }).result.id).toBe("recordedhero1");
    expect((await getRun(new Request("http://x/api/run?id=nope"))).status).toBe(404);
    expect((await getRun(new Request("http://x/api/run?id=../x"))).status).toBe(400);
  });
});

describe("single-flight", () => {
  it("shares one run between identical concurrent requests, and both see its events", async () => {
    const llm = new SlowCountingLLM();
    const deps = { qloo: new QlooClient({ cache: new MemoryCache(), fixtures: {} }), llm, cache: new MemoryCache() };
    const brief = Brief.parse(must(PRESETS[2]).brief);
    const [la, lb] = await Promise.all([cachedRun(brief, deps), cachedRun(brief, deps)]);
    const a: RunEvent[] = [];
    const b: RunEvent[] = [];
    const [ra, rb] = await Promise.all([getOrRun(la, (e) => a.push(e)), getOrRun(lb, (e) => b.push(e))]);
    expect(ra.result.id).toBe(rb.result.id);
    expect(llm.drafts).toBe(2); // grounded + baseline, once
    expect(a.filter((e) => e.type === "step").length).toBe(b.filter((e) => e.type === "step").length);
    expect(resultEvent(b)?.result.id).toBe(ra.result.id);
  });
});
