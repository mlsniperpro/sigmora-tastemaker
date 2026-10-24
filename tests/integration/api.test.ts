/** Route handlers (/api/run, /api/ship) over the offline stack: streaming, caching, validation and failure paths. */
import { describe, expect, it, vi } from "vitest";
import { POST as run } from "@/app/api/run/route";
import { POST as ship } from "@/app/api/ship/route";
import { Brief } from "@/lib/agent/brief";
import { PRESETS } from "@/lib/agent/presets";
import { DEGRADED_TTL, RESULT_TTL, cachedRun, getOrRun, isHealthy, runById, runKey } from "@/lib/agent/runCache";
import { RUN_SCHEMA_VERSION, type RunEvent, type RunResult } from "@/lib/agent/types";
import { DeterministicLLM } from "@/lib/llm/deterministic";
import { SandboxPublisher, SigmoraPublisher, publisherFromEnv } from "@/lib/publisher";
import { MemoryCache } from "@/lib/qloo/cache";
import { QlooClient } from "@/lib/qloo/client";

const post = (body: unknown) =>
  new Request("http://x/api", { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": "1.2.3.4" }, body: typeof body === "string" ? body : JSON.stringify(body) });

async function events(res: Response): Promise<RunEvent[]> {
  return (await res.text())
    .trim()
    .split("\n")
    .map((l) => JSON.parse(l) as RunEvent);
}
const resultOf = (ev: RunEvent[]) => (ev.find((e) => e.type === "result") as { result: RunResult } | undefined)?.result;

describe("/api/run", () => {
  it("streams trace steps then a result for a preset", async () => {
    const res = await run(post({ preset: "indie-release" }));
    expect(res.headers.get("content-type")).toMatch(/ndjson/);
    const ev = await events(res);
    expect(ev.filter((e) => e.type === "step").length).toBeGreaterThan(10);
    expect(ev.at(-1)?.type).toBe("result");
  });

  it("serves a repeat run from the result cache", async () => {
    await (await run(post({ preset: "dtc-city" }))).text();
    const res = await run(post({ preset: "dtc-city" }));
    expect(res.headers.get("x-run-cache")).toBe("hit");
    expect(resultOf(await events(res))).toBeDefined();
  });

  it("finishes and caches the run even if the client disconnects mid-stream", async () => {
    const res = await run(post({ preset: "sports-club" }));
    const reader = res.body!.getReader();
    await reader.read();
    await reader.cancel();
    await vi.waitFor(async () => expect((await run(post({ preset: "sports-club" }))).headers.get("x-run-cache")).toBe("hit"), { timeout: 5000 });
  });

  it("rejects bad JSON, invalid briefs and unknown presets", async () => {
    expect((await run(post("{nope"))).status).toBe(400);
    const bad = await run(post({ brief: { family: "music" } }));
    expect(bad.status).toBe(400);
    expect((await bad.json()).error).toMatch(/subject/);
    expect((await run(post({ preset: "nope" }))).status).toBe(404);
    expect((await run(post({ brief: { ...PRESETS[0].brief, seeds: Array(9).fill("x") } }))).status).toBe(400);
  });

  it("ends the stream with an error event when no seed resolves", async () => {
    const res = await run(post({ brief: { family: "music", subject: "x", product: "y", seeds: ["Qqqzzz Unknown"], ages: ["25_to_29"], goal: "g" } }));
    expect((await events(res)).at(-1)).toMatchObject({ type: "error", message: expect.stringMatching(/resolve/) });
  });
});

describe("result cache health", () => {
  class DownCompare extends QlooClient {
    override compare(): never {
      throw new Error("Qloo 500 on /v2/analysis/compare");
    }
  }
  it("caches a degraded run only briefly, and keeps it by id for Ship", async () => {
    const cache = new MemoryCache();
    const ttls: number[] = [];
    const spy = { get: (k: string) => cache.get(k), set: (k: string, v: unknown, ttl: number) => (ttls.push(ttl), cache.set(k, v, ttl)) };
    const brief = Brief.parse(PRESETS[0].brief);
    const deps = { qloo: new DownCompare({ cache: new MemoryCache(), fixtures: {} }), llm: new DeterministicLLM(), cache: spy };
    const first = await getOrRun(await cachedRun(brief, deps));
    expect(isHealthy(first.result)).toBe(false);
    expect(ttls).toEqual([RESULT_TTL, DEGRADED_TTL]);
    expect(await runById(first.result.id, cache)).toBeDefined();
  });

  it("ignores a corrupt cache entry instead of serving it", async () => {
    const cache = new MemoryCache();
    await cache.set(`result:v${RUN_SCHEMA_VERSION}:abc`, { id: "abc", junk: true }, 60);
    expect(await runById("abc", cache)).toBeUndefined();
    const brief = Brief.parse(PRESETS[0].brief);
    const llm = new DeterministicLLM();
    const qloo = new QlooClient({ cache: new MemoryCache(), fixtures: {} });
    await cache.set(runKey(brief, llm.id, qloo.primarySource), { id: "abc" }, 60);
    expect((await getOrRun(await cachedRun(brief, { qloo, llm, cache }))).cached).toBe(false);
  });
});

describe("/api/ship", () => {
  it("ships a run the server produced, using the server's captions", async () => {
    const ev = await events(await run(post({ preset: "indie-release" })));
    const result = resultOf(ev)!;
    const res = await ship(post({ runId: result.id, posts: [{ platform: "X", text: "injected" }] }));
    expect(res.status).toBe(200);
    const receipt = await res.json();
    expect(receipt.publisher).toBe("sandbox");
    expect(receipt.posts.map((p: { platform: string }) => p.platform)).toEqual(result.grounded.draft.captions.map((c) => c.platform));
  });
  it("gives every run its own id, even for the same brief", async () => {
    const brief = Brief.parse(PRESETS[2].brief);
    const mk = () => ({ qloo: new QlooClient({ cache: new MemoryCache(), fixtures: {} }), llm: new DeterministicLLM(), cache: new MemoryCache() });
    const a = await getOrRun(await cachedRun(brief, mk()));
    const b = await getOrRun(await cachedRun(brief, mk()));
    expect(a.result.id).not.toBe(b.result.id);
  });

  it("404s an unknown run and 400s a malformed id", async () => {
    expect((await ship(post({ runId: "doesnotexist" }))).status).toBe(404);
    expect((await ship(post({ runId: "../etc/passwd" }))).status).toBe(400);
    expect((await ship(post("{"))).status).toBe(400);
  });
});

describe("publisher", () => {
  const plan = { runId: "r1", subject: "Nia Sol", posts: [{ platform: "TikTok", text: "a" }, { platform: "X", text: "b" }], verifiedPicks: ["Tems"] };
  const fastRetry = { retries: 2, baseMs: 1, maxMs: 2, sleep: async () => undefined };

  it("defaults to the labeled sandbox unless live mode is fully configured", () => {
    expect(publisherFromEnv({}).id).toBe("sandbox");
    expect(publisherFromEnv({ SIGMORA_API_URL: "https://s.example", SIGMORA_API_TOKEN: "t" }).id).toBe("sandbox");
    expect(publisherFromEnv({ SIGMORA_PUBLISH_MODE: "live", SIGMORA_API_URL: "https://s.example", SIGMORA_API_TOKEN: "t" }).id).toBe("sigmora");
  });

  it("sandbox schedules without posting", async () => {
    const r = await new SandboxPublisher().ship(plan, new Date("2026-10-24T10:00:00Z"));
    expect(r.posts.map((p) => p.scheduledFor)).toEqual(["2026-10-25T17:00:00.000Z", "2026-10-26T17:00:00.000Z"]);
    expect(r.posts.every((p) => p.status === "sandbox")).toBe(true);
  });

  it("calls Sigmora /v1 with a bearer token and one idempotency key across retries", async () => {
    const replies = [new Response("busy", { status: 503 }), Response.json({ id: "c1", posts: [{ id: "p1" }, { id: "p2" }] })];
    const f = vi.fn(async () => replies.shift()!);
    const r = await new SigmoraPublisher("https://api.example/", "tok", f as unknown as typeof fetch, fastRetry).ship(plan);
    expect(f).toHaveBeenCalledTimes(2);
    const keys = f.mock.calls.map((c) => ((c as unknown as [string, RequestInit])[1].headers as Record<string, string>)["idempotency-key"]);
    expect(keys).toEqual(["tastemaker-r1", "tastemaker-r1"]);
    const [url, init] = f.mock.calls[1] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.example/v1/campaigns");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer tok");
    expect(r).toMatchObject({ campaignId: "c1", publisher: "sigmora" });
    expect(r.posts[1].externalId).toBe("p2");
  });

  it("rejects a Sigmora reply without a campaign id", async () => {
    const f = vi.fn(async () => Response.json({ ok: true }));
    await expect(new SigmoraPublisher("https://api.example", "tok", f as unknown as typeof fetch, fastRetry).ship(plan)).rejects.toThrow();
  });
});
