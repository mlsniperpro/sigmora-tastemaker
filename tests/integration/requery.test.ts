/** Measure → re-query over HTTP: the Sigmora metrics client and /api/requery, with Sigmora stubbed. */
import { describe, expect, it, vi } from "vitest";
import { POST as requery } from "@/app/api/requery/route";
import { POST as run } from "@/app/api/run/route";
import type { Brief } from "@/lib/agent/brief";
import { SHIPPED_TTL, keepShippedRun } from "@/lib/agent/runCache";
import type { RunEvent, RunResult } from "@/lib/agent/types";
import { MetricsUnavailableError, SandboxPublisher, SigmoraPublisher } from "@/lib/publisher";
import { must } from "../must";

const fastRetry = { retries: 2, baseMs: 1, maxMs: 2, sleep: async () => undefined };
const post = (body: unknown) => new Request("http://x/api", { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": "5.6.7.8" }, body: JSON.stringify(body) });

function useLiveSigmora(reply: unknown) {
  vi.stubEnv("SIGMORA_PUBLISH_MODE", "live");
  vi.stubEnv("SIGMORA_API_URL", "https://sigmora.example");
  vi.stubEnv("SIGMORA_API_TOKEN", "tok");
  const f = vi.fn<typeof fetch>(async () => Response.json(reply));
  vi.stubGlobal("fetch", f);
  return f;
}

async function heroRun(): Promise<RunResult> {
  const lines = (await (await run(post({ preset: "indie-release" }))).text()).trim().split("\n");
  const last = JSON.parse(must(lines.at(-1))) as RunEvent;
  if (last.type !== "result") throw new Error("run did not finish");
  return last.result;
}

describe("SigmoraPublisher.metrics", () => {
  const metrics = { id: "c1", metadata: { tastemakerRunId: "r1" }, posts: [{ platform: "TikTok", text: "Tems fans: out now", impressions: 900, engagements: 80 }] };

  it("reads a campaign's measured posts and its run with the bearer token, retrying transient failures", async () => {
    const replies = [new Response("busy", { status: 503 }), Response.json(metrics)];
    const f = vi.fn(async () => must(replies.shift()));
    const m = await new SigmoraPublisher("https://api.example", "tok", f, fastRetry).metrics("c1");
    expect(m).toEqual({ campaignId: "c1", runId: "r1", posts: metrics.posts });
    const [url, init] = f.mock.calls[1] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.example/v1/campaigns/c1/metrics");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer tok");
  });

  it("won't measure a campaign Tastemaker didn't ship, or a malformed reply", async () => {
    const foreign = vi.fn(async () => Response.json({ ...metrics, metadata: {} }));
    await expect(new SigmoraPublisher("https://api.example", "tok", foreign, fastRetry).metrics("c1")).rejects.toBeInstanceOf(MetricsUnavailableError);
    const bad = vi.fn(async () => Response.json({ ...metrics, posts: [{ platform: "X", text: "x", impressions: -5, engagements: 1 }] }));
    await expect(new SigmoraPublisher("https://api.example", "tok", bad, fastRetry).metrics("c1")).rejects.toMatchObject({ name: "ZodError" });
  });

  it("the sandbox has nothing to measure and says so", async () => {
    await expect(new SandboxPublisher().metrics()).rejects.toBeInstanceOf(MetricsUnavailableError);
  });
});

describe("keepShippedRun", () => {
  it("keeps a shipped run for the measuring window, under the same id", async () => {
    const r = await heroRun();
    const set = vi.fn(async () => undefined);
    await keepShippedRun(r, { get: async () => undefined, set });
    expect(set).toHaveBeenCalledWith(expect.stringContaining(r.id), r, SHIPPED_TTL);
    expect(SHIPPED_TTL).toBeGreaterThanOrEqual(14 * 24 * 3600);
  });
});

describe("/api/requery", () => {
  it("409s on the sandbox and 400s bad input", async () => {
    const res = await requery(post({ campaignId: "sandbox-x" }));
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: string }).error).toMatch(/nothing to measure/);
    expect((await requery(post({ campaignId: "../x" }))).status).toBe(400);
    expect((await requery(post({}))).status).toBe(400);
  });

  it("404s when the campaign's run is gone", async () => {
    useLiveSigmora({ id: "c2", metadata: { tastemakerRunId: "expiredrun" }, posts: [] });
    const res = await requery(post({ campaignId: "c2" }));
    expect(res.status).toBe(404);
    expect(((await res.json()) as { error: string }).error).toMatch(/expired/);
  });

  it("returns the next brief, seeded with the verified picks from the posts that performed", async () => {
    const r = await heroRun();
    const verified = r.grounded.receipts.filter((x) => x.verdict === "pass" && x.role !== "city" && x.role !== "venue").map((x) => x.name);
    const captions = r.grounded.draft.captions;
    const best = must(captions.find((c) => verified.some((v) => c.text.includes(v))), "a caption naming a verified pick");
    const posts = captions.map((c) => ({ platform: c.platform, text: c.text, impressions: 2000, engagements: c === best ? 300 : 20 }));
    const f = useLiveSigmora({ id: "c9", metadata: { tastemakerRunId: r.id }, posts });

    const res = await requery(post({ campaignId: "c9" }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { brief: Brief; winners: { name: string }[] };
    expect(body.winners.length).toBeGreaterThan(0);
    for (const w of body.winners) expect(best.text).toContain(w.name);
    expect(body.brief.seeds.slice(0, body.winners.length)).toEqual(body.winners.map((w) => w.name));
    expect(f.mock.calls.map((c) => c[0])).toEqual(["https://sigmora.example/v1/campaigns/c9/metrics"]);
  });
});
