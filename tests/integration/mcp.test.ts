/** The MCP endpoint (Streamable HTTP, 2025-06-18) over the offline stack. */
import { describe, expect, it, vi } from "vitest";
import { GET, POST } from "@/app/api/mcp/route";
import { handleRpc } from "@/lib/mcp";
import { must } from "../must";

const rpc = (body: unknown, headers: Record<string, string> = {}) =>
  POST(new Request("http://tm.example/api/mcp", { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...headers }, body: typeof body === "string" ? body : JSON.stringify(body) }));
/** The reply shapes these tests read (a test-side view, not the server's types). */
interface RpcReply {
  error: { code: number };
  result: {
    protocolVersion: string;
    tools: { name: string; inputSchema: { required?: string[]; properties: Record<string, { maxItems?: number }>; anyOf?: unknown[] } }[];
    isError?: boolean;
    content: { text: string }[];
    structuredContent: { id: string; receipts: { name: string; verdict: string }[]; suggestions: unknown[] };
  };
}
const reply = async (res: Promise<Response> | Response) => (await (await res).json()) as RpcReply;
const call = (id: number, name: string, args: unknown) => ({ jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: args } });

describe("MCP transport", () => {
  it("initializes and negotiates the protocol version", async () => {
    const res = await reply(rpc({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "t", version: "1" } } }));
    expect(res.result.protocolVersion).toBe("2025-03-26");
    const latest = await reply(rpc({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "1999-01-01" } }));
    expect(latest.result.protocolVersion).toBe("2025-06-18");
  });

  it("acknowledges notifications (even a ping without id) with 202 and no body", async () => {
    for (const method of ["notifications/initialized", "ping"]) {
      const res = await rpc({ jsonrpc: "2.0", method });
      expect(res.status).toBe(202);
      expect(await res.text()).toBe("");
    }
  });

  it("rejects batches (removed in 2025-06-18), malformed JSON and invalid messages", async () => {
    expect((await rpc([{ jsonrpc: "2.0", id: 1, method: "ping" }])).status).toBe(400);
    const parse = await rpc("{oops");
    expect(parse.status).toBe(400);
    expect((await reply(parse)).error.code).toBe(-32700);
    for (const bad of [null, 42, {}, { jsonrpc: "1.0", id: 1, method: "ping" }, { jsonrpc: "2.0", id: 1 }]) {
      const res = await reply(rpc(bad));
      expect(res.error.code).toBe(-32600);
    }
  });

  it("rejects unsupported protocol versions and cross-origin browser calls", async () => {
    expect((await rpc({ jsonrpc: "2.0", id: 1, method: "ping" }, { "mcp-protocol-version": "1999-01-01" })).status).toBe(400);
    expect((await rpc({ jsonrpc: "2.0", id: 1, method: "ping" }, { "mcp-protocol-version": "2025-06-18" })).status).toBe(200);
    expect((await rpc({ jsonrpc: "2.0", id: 1, method: "ping" }, { origin: "https://evil.example" })).status).toBe(403);
    expect((await rpc({ jsonrpc: "2.0", id: 1, method: "ping" }, { origin: "http://tm.example" })).status).toBe(200);
  });

  it("405s GET with an Allow header", () => {
    const res = GET();
    expect(res.status).toBe(405);
    expect(res.headers.get("allow")).toBe("POST");
  });

  it("answers unknown methods and tools with JSON-RPC errors", async () => {
    expect((await reply(rpc({ jsonrpc: "2.0", id: 6, method: "nope" }))).error.code).toBe(-32601);
    expect((await reply(rpc(call(7, "nope", {})))).error.code).toBe(-32602);
  });
});

describe("MCP tools", () => {
  it("lists the tools", async () => {
    const res = await reply(rpc({ jsonrpc: "2.0", id: 2, method: "tools/list" }));
    expect(res.result.tools.map((t) => t.name)).toEqual(["taste_check", "audit_plan", "plan_campaign"]);
  });

  it("taste_check flags invented, off-taste and wrong-city picks and suggests replacements", async () => {
    const res = await reply(
      rpc(
        call(3, "taste_check", {
          seeds: ["Tems", "Rema"],
          ages: ["25_to_29"],
          city: "Washington",
          picks: [
            { name: "Ayra Starr", type: "artist", role: "collab" },
            { name: "Nickelback", type: "artist", role: "collab" },
            { name: "Lagos Velvet Collective", type: "artist", role: "collab" },
            { name: "Madison Square Garden", type: "place", role: "venue" },
          ],
        }),
      ),
    );
    const out = res.result.structuredContent;
    const verdicts = Object.fromEntries(out.receipts.map((r) => [r.name, r.verdict]));
    expect(verdicts).toEqual({ "Ayra Starr": "pass", Nickelback: "miss", "Lagos Velvet Collective": "hallucination", "Madison Square Garden": "miss" });
    expect(out.suggestions.length).toBeGreaterThanOrEqual(2);
    expect(res.result.content[0]?.text).toMatch(/invented/);
  });

  it("plan_campaign runs a preset, and serves the repeat from the run cache", async () => {
    const a = await reply(rpc(call(4, "plan_campaign", { preset: "sports-club" })));
    const b = await reply(rpc(call(5, "plan_campaign", { preset: "sports-club" })));
    expect(a.result.structuredContent.receipts.length).toBeGreaterThan(5);
    expect(b.result.structuredContent.id).toBe(a.result.structuredContent.id);
  });

  it("returns argument errors in-band without leaking internals", async () => {
    const bad = await reply(rpc(call(8, "taste_check", { seeds: [] })));
    expect(bad.result.isError).toBe(true);
    expect(bad.result.content[0]?.text).toMatch(/^Invalid arguments/);
  });

  it("doesn't spend the rate limit on free (offline) calls", async () => {
    const reply = await handleRpc(call(9, "taste_check", { seeds: ["Tems"], ages: ["25_to_29"], picks: [{ name: "Rema", type: "artist", role: "collab" }] }), () => Promise.resolve({ ok: false, status: 429, message: "Rate limit", retryAfter: 60 } as const));
    expect(reply).toMatchObject({ result: { structuredContent: { receipts: [expect.objectContaining({ name: "Rema" })] } } });
  });

  it("refuses paid calls when the gate says no", async () => {
    vi.stubEnv("QLOO_API_KEY", "k");
    const reply = await handleRpc(call(10, "taste_check", { seeds: ["Tems"], ages: ["25_to_29"], picks: [{ name: "Rema", type: "artist", role: "collab" }] }), () => Promise.resolve({ ok: false, status: 503, message: "Today's budget for new runs is spent.", retryAfter: 3600 } as const));
    expect(reply).toMatchObject({ result: { isError: true, content: [{ text: "Today's budget for new runs is spent." }] } });
  });

  it("taste_check accepts city picks and checks them against the given market", async () => {
    const res = await reply(rpc(call(11, "taste_check", { seeds: ["Glossier"], ages: ["25_to_29"], city: "Atlanta", picks: [{ name: "Atlanta", type: "locality", role: "city" }, { name: "Dallas", type: "locality", role: "city" }] })));
    expect(res.result.structuredContent.receipts.map((r) => r.verdict)).toEqual(["pass", "miss"]);
  });

  it("publishes input schemas generated from the enforced zod schemas", async () => {
    const res = await reply(rpc({ jsonrpc: "2.0", id: 12, method: "tools/list" }));
    const taste = must(res.result.tools[0]).inputSchema;
    expect(taste.required).toEqual(expect.arrayContaining(["seeds", "ages", "picks"]));
    expect(taste.properties.ages?.maxItems).toBe(6);
    const audit = must(res.result.tools.find((t) => t.name === "audit_plan")).inputSchema;
    expect(audit.required).toEqual(expect.arrayContaining(["text", "seeds", "ages"]));
    expect(res.result.tools.find((t) => t.name === "plan_campaign")?.inputSchema.anyOf).toHaveLength(2);
  });
});

describe("audit_plan", () => {
  it("audits a pasted plan through MCP, labelled as simulated offline, and serves a repeat from cache", async () => {
    const args = { text: "Collab targets: Ayra Starr, Lagos Velvet Collective\nBrand partners: Fenty Beauty", seeds: ["Tems", "Rema"], ages: ["25_to_29"] };
    const first = await reply(rpc(call(21, "audit_plan", args)));
    const out = first.result.structuredContent as unknown as { receipts: { name: string; verdict: string }[]; simulated: boolean; cached?: boolean };
    expect(out.simulated).toBe(true);
    expect(out.receipts.map((r) => r.name)).toEqual(["Ayra Starr", "Lagos Velvet Collective", "Fenty Beauty"]);
    expect(first.result.content[0]?.text).toMatch(/offline simulator/);
    const again = await reply(rpc(call(22, "audit_plan", args)));
    expect((again.result.structuredContent as unknown as { cached?: boolean }).cached).toBe(true);
  });

  it("rejects bad arguments as a tool error, not a crash", async () => {
    const bad = await reply(rpc(call(23, "audit_plan", { text: "short", seeds: [], ages: [] })));
    expect(bad.result.isError).toBe(true);
    expect(bad.result.content[0]?.text).toMatch(/Invalid arguments/);
  });
});

