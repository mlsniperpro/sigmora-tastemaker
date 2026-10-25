/** POST /api/audit over the offline stack: validation, origin, the budget refusal path and a full offline audit. */
import { describe, expect, it, vi } from "vitest";
import { POST as audit } from "@/app/api/audit/route";
import { AUDIT_CALL_ESTIMATE, auditPlan, type AuditResult } from "@/lib/agent/audit";
import { AUDIT_SAMPLE, AUDIT_SAMPLE_AUDIENCE } from "@/lib/auditSample";
import { DeterministicLLM } from "@/lib/llm/deterministic";
import { MemoryCache } from "@/lib/qloo/cache";
import { QlooClient } from "@/lib/qloo/client";
import type { QlooPath } from "@/lib/qloo/params";
import { simulate } from "@/lib/qloo/sim/simulator";

let ip = 0;
/** Each request from its own address unless one is given, so per-IP limits don't leak between tests. */
const post = (body: unknown, headers: Record<string, string> = {}) =>
  new Request("http://tm.example/api/audit", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": `10.9.0.${String(++ip)}`, host: "tm.example", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
const sample = { text: AUDIT_SAMPLE, ...AUDIT_SAMPLE_AUDIENCE };
const errorOf = async (res: Response) => ((await res.json()) as { error: string }).error;

describe("/api/audit validation", () => {
  it("rejects bad JSON, short or long text, a missing audience and unknown fields", async () => {
    expect((await audit(post("{nope"))).status).toBe(400);
    const short = await audit(post({ ...sample, text: "too short" }));
    expect(short.status).toBe(400);
    expect(await errorOf(short)).toMatch(/text/);
    expect((await audit(post({ ...sample, text: "x".repeat(4001) }))).status).toBe(400);
    expect((await audit(post({ ...sample, seeds: [] }))).status).toBe(400);
    expect((await audit(post({ ...sample, ages: ["teens"] }))).status).toBe(400);
    expect((await audit(post({ ...sample, picks: [] }))).status).toBe(400);
  });

  it("refuses a cross-site browser request", async () => {
    const res = await audit(post(sample, { origin: "https://evil.example" }));
    expect(res.status).toBe(403);
  });

  it("says so when none of the audience's names resolve", async () => {
    const res = await audit(post({ ...sample, seeds: ["Qqqzzz Unknown"] }));
    expect(res.status).toBe(422);
    expect(await errorOf(res)).toMatch(/audience's names/);
  });
});

describe("/api/audit budget", () => {
  it("is refused up front, before any Qloo call, when today's live budget can't cover it, and a refusal doesn't count toward the rate limit", async () => {
    vi.stubEnv("QLOO_API_KEY", "k");
    vi.stubEnv("QLOO_DAILY_CALL_CAP", "0");
    vi.stubEnv("RATE_LIMIT_PER_MINUTE", "1");
    vi.useFakeTimers({ toFake: ["Date"], now: Date.parse("2026-10-25T13:00:10Z") });
    try {
      const fetchSpy = vi.fn(() => Promise.reject(new Error("no network in this test")));
      vi.stubGlobal("fetch", fetchSpy);
      const from = { "x-forwarded-for": "10.8.0.1" };
      for (let i = 0; i < 2; i++) {
        const spent = await audit(post(sample, from));
        expect(spent.status).toBe(503);
        expect(spent.headers.get("retry-after")).toBe("3600");
        expect(await errorOf(spent)).toMatch(/Qloo budget/);
      }
      expect(fetchSpy).not.toHaveBeenCalled();
      // With budget, a live audit is a paid request: the same network's next one inside the minute is rate-limited, before any Qloo call.
      // Room for two audits from one network (the first one's failed calls are spent), so the second meets the per-minute limit.
      vi.stubEnv("QLOO_DAILY_CALL_CAP", "960");
      vi.stubEnv("QLOO_IP_DAILY_CALLS", "240");
      await audit(post(sample, from));
      const calls = fetchSpy.mock.calls.length;
      const limited = await audit(post(sample, from));
      expect(limited.status).toBe(429);
      expect(fetchSpy.mock.calls.length).toBe(calls);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("/api/audit offline", () => {
  it("audits the sample plan end to end, labelled as simulated, with Qloo-style receipts and suggestions", async () => {
    const res = await audit(post(sample));
    expect(res.status).toBe(200);
    const r = (await res.json()) as AuditResult;
    expect(r.simulated).toBe(true);
    expect(r.sources).toContain("simulated");
    expect(r.extraction.by).toBe("scanner");
    const verdict = (name: string) => r.receipts.find((x) => x.name === name)?.verdict;
    // The invented names on labelled lines come back not found; the rest are judged.
    expect(verdict("Kemi Adebayo-Rhodes")).toBe("hallucination");
    expect(verdict("The Highlife Hour")).toBe("hallucination");
    expect(verdict("Ayra Starr")).toBe("pass");
    expect(r.receipts.length).toBeGreaterThanOrEqual(12);
    expect(r.receipts.length).toBeLessThanOrEqual(15);
    expect(r.metrics.picks).toBe(r.receipts.length);
    // Suggestions on simulated data name no placeholder score.
    expect(r.suggestions.length).toBeGreaterThan(0);
    for (const s of r.suggestions) expect(s.reason).not.toMatch(/\d\.\d\d|Qloo-preferred/);
  });

  it("stays within the calls it reserves on a worst-case plan, live wire format", async () => {
    // Many invented names (two searches each), prose names, five seeds and six named cities ranked among the US metros.
    const text = [
      "Plan",
      "- Collab targets: Qorvax Blee, Zintar Mullo, Pexo Drane",
      "- Brand partners: Vlorbo Cola, Snizzle Wear",
      "- References: Glimmerfall Saga, Throbnar Nights, The Wexley Files",
      "- Podcast pitch: Mumbo Pod Hour",
      "- Presenter: Kalvo Pretz",
      "- Venue: Xantu Hall",
      "- Films: Zebulon Rising",
      "- Launch city: Lagos, Nairobi, Accra, Kampala, Kigali, Dakar",
      "We will tour with Wizkid and Davido, hit Love Island USA, partner with Sephora and Adidas, then pop up with Doja Cat and SZA and Drake and Kendrick Lamar and Olivia Rodrigo.",
    ].join("\n");
    let sent = 0;
    const fetchImpl = (async (u: string | URL) => {
      sent++;
      const url = new URL(String(u));
      const params: Record<string, string> = {};
      url.searchParams.forEach((v, k) => (params[k] = v));
      return Response.json(simulate(url.pathname as QlooPath, params));
    }) as typeof fetch;
    const qloo = new QlooClient({ mode: "live", apiKey: "k", fixtures: {}, cache: new MemoryCache(), fetchImpl, runCallCap: 1000 });
    const r = await auditPlan({ text, seeds: ["Asake", "Olamide", "Fireboy DML", "Omah Lay", "Kizz Daniel"], ages: ["25_to_29"] }, { qloo, llm: new DeterministicLLM() });
    expect(r.receipts.length).toBeGreaterThan(10);
    expect(sent).toBeLessThanOrEqual(AUDIT_CALL_ESTIMATE);
  });

  it("stays within the calls it reserves", async () => {
    const qloo = new QlooClient({ cache: new MemoryCache(), fixtures: {} });
    let calls = 0;
    qloo.observe(() => calls++);
    const r = await auditPlan(sample, { qloo, llm: new DeterministicLLM() });
    expect(r.receipts.length).toBeGreaterThan(0);
    expect(calls).toBeLessThanOrEqual(AUDIT_CALL_ESTIMATE);
  });

  it("returns an empty audit, without a Qloo check, when the text names nothing", async () => {
    const res = await audit(post({ ...sample, text: "we will post every day and grow the audience organically over time" }));
    expect(res.status).toBe(200);
    const r = (await res.json()) as AuditResult;
    expect(r.receipts).toEqual([]);
    expect(r.metrics.picks).toBe(0);
  });
});
