import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST as run } from "@/app/api/run/route";
import { POST as ship } from "@/app/api/ship/route";
import { checkGuard, resetGuard } from "@/lib/guard";
import { SandboxPublisher, SigmoraPublisher, publisherFromEnv, schedule } from "@/lib/publisher";
import type { RunEvent } from "@/lib/agent/types";

const post = (body: unknown) =>
  new Request("http://x/api", { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": "1.2.3.4" }, body: JSON.stringify(body) });

async function events(res: Response): Promise<RunEvent[]> {
  return (await res.text()).trim().split("\n").map((l) => JSON.parse(l));
}

describe("/api/run", () => {
  beforeEach(() => resetGuard());

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
  });

  it("rejects malformed briefs and unknown presets", async () => {
    expect((await run(post({ brief: { family: "music" } }))).status).toBe(400);
    expect((await run(post({ preset: "nope" }))).status).toBe(404);
  });

  it("returns an error event when no seed resolves", async () => {
    const res = await run(post({ brief: { family: "music", subject: "x", product: "y", seeds: ["Qqqzzz Unknown"], ages: ["25_to_29"], goal: "g" } }));
    const ev = await events(res);
    expect(ev.at(-1)).toMatchObject({ type: "error" });
  });
});

describe("guard", () => {
  beforeEach(() => resetGuard());
  it("rate-limits per IP and refills over time", () => {
    const cfg = { burst: 2, perMinute: 1, dailyCap: 100 };
    expect(checkGuard("a", cfg, 0).ok).toBe(true);
    expect(checkGuard("a", cfg, 0).ok).toBe(true);
    expect(checkGuard("a", cfg, 0).ok).toBe(false);
    expect(checkGuard("b", cfg, 0).ok).toBe(true);
    expect(checkGuard("a", cfg, 61000).ok).toBe(true);
  });
  it("enforces the daily cap", () => {
    const cfg = { burst: 10, perMinute: 10, dailyCap: 1 };
    expect(checkGuard("a", cfg, 0).ok).toBe(true);
    const r = checkGuard("b", cfg, 0);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.status).toBe(503);
  });
});

describe("publisher", () => {
  const req = { runId: "r1", subject: "Nia Sol", posts: [{ platform: "TikTok", text: "a" }, { platform: "X", text: "b" }], verifiedPicks: ["Tems"] };

  it("defaults to the labeled sandbox", async () => {
    expect(publisherFromEnv({}).id).toBe("sandbox");
    expect(publisherFromEnv({ SIGMORA_API_URL: "u", SIGMORA_API_TOKEN: "t" }).id).toBe("sandbox");
    const r = await new SandboxPublisher().ship(req, new Date("2026-10-24T10:00:00Z"));
    expect(r.posts.map((p) => p.scheduledFor)).toEqual(["2026-10-25T17:00:00.000Z", "2026-10-26T17:00:00.000Z"]);
    expect(r.posts.every((p) => p.status === "sandbox")).toBe(true);
  });

  it("calls Sigmora /v1 with a bearer token when live", async () => {
    const f = vi.fn(async () => Response.json({ id: "c1", posts: [{ id: "p1" }, { id: "p2" }] }));
    const r = await new SigmoraPublisher("https://api.example", "tok", f as unknown as typeof fetch).ship(req);
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.example/v1/campaigns");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer tok");
    expect(r.campaignId).toBe("c1");
    expect(r.posts[1].externalId).toBe("p2");
  });

  it("schedules one post a day", () => {
    expect(schedule(req, new Date("2026-12-31T23:00:00Z"))[1].scheduledFor).toBe("2027-01-02T17:00:00.000Z");
  });

  it("ship route returns sandbox receipts", async () => {
    const res = await ship(post(req));
    expect(res.status).toBe(200);
    expect((await res.json()).publisher).toBe("sandbox");
  });
});
