/** The audit panel's one-click sample answers even when a new audit is refused: its recorded live audit is served, labelled. */
import { describe, expect, it, vi } from "vitest";
import { POST as audit } from "@/app/api/audit/route";
import { isSampleAudit, recordedSampleAudit, type AuditResult } from "@/lib/agent/audit";
import { AUDIT_SAMPLE, AUDIT_SAMPLE_AUDIENCE } from "@/lib/auditSample";

// A recorded live audit of the sample, as `pnpm runs:record` would write it.
vi.mock("../../fixtures/audits/recorded.json", () => ({
  default: {
    sample: {
      receipts: [{ name: "Ayra Starr", type: "artist", role: "collab", verdict: "pass", affinity: 0.81, drivers: [], calls: [], note: "recorded" }],
      metrics: { picks: 1, judged: 1, hallucinations: 0, misses: 0, fading: 0, unscored: 0, cultureMissRate: 0 },
      suggestions: [],
      sources: ["live"],
      warnings: [],
      extraction: { by: "model", capped: false },
      simulated: false,
    },
  },
}));

const sample = { text: AUDIT_SAMPLE, ...AUDIT_SAMPLE_AUDIENCE };
const post = (body: unknown, ip: string) =>
  new Request("http://tm.example/api/audit", { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": ip, host: "tm.example" }, body: JSON.stringify(body) });

describe("the recorded sample audit", () => {
  it("knows the sample exactly, and only the sample", () => {
    expect(isSampleAudit(sample)).toBe(true);
    expect(isSampleAudit({ ...sample, text: `${AUDIT_SAMPLE}\nOne more line.` })).toBe(false);
    expect(isSampleAudit({ ...sample, seeds: ["Tems"] })).toBe(false);
    expect(recordedSampleAudit({ sample: { junk: true } })).toBeUndefined();
    expect(recordedSampleAudit()).toBeDefined();
  });

  it("is served, labelled, when a live audit of the sample is refused; other text still gets the refusal", async () => {
    vi.stubEnv("QLOO_API_KEY", "k");
    vi.stubEnv("QLOO_MODE", "live");
    vi.stubEnv("QLOO_DAILY_CALL_CAP", "0");
    vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new Error("no network in this test"))));
    const res = await audit(post(sample, "10.7.0.1"));
    expect(res.status).toBe(200);
    const r = (await res.json()) as AuditResult;
    expect(r).toMatchObject({ recorded: true, cached: true });
    expect(r.refusedBecause).toMatch(/Qloo budget/);
    expect((await audit(post({ ...sample, text: `${AUDIT_SAMPLE}\nOne more line.` }, "10.7.0.2"))).status).toBe(503);
  });
});
