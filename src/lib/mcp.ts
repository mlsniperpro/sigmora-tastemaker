/**
 * Tastemaker as an MCP server (Streamable HTTP, stateless JSON responses), so
 * any agent can call "taste-check this campaign". Implements the subset of
 * MCP a tool server needs: initialize, ping, tools/list, tools/call.
 */
import { z } from "zod";
import { Brief, PICK_TYPES, ROLES } from "./agent/brief";
import { PRESETS } from "./agent/presets";
import { RunRequest } from "./agent/brief";
import { placeholderReason } from "./agent/evidence";
import { cachedRun, costsMoney, getOrRun, resolveRunRequest } from "./agent/runCache";
import { tasteCheck } from "./agent/tasteCheck";
import type { Receipt } from "./agent/types";
import type { GuardResult } from "./guard";
import { qlooFromEnv } from "./qloo/client";
import { formatZodIssues } from "./zod";

export const SUPPORTED_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"];

/** Audience fields reuse the Brief's own rules, so the limits can't drift. */
const TasteCheckArgs = Brief.pick({ seeds: true, ages: true, gender: true })
  .extend({
    city: Brief.shape.targetCity.describe("Launch city: a city pick must match it, and venue picks must be in it"),
    picks: z
      .array(z.object({ name: z.string().min(1).max(100), type: z.enum(PICK_TYPES), role: z.enum(ROLES) }))
      .min(1)
      .max(20),
  })
  .strict();

/** JSON Schema for a tool's input, generated from the zod schema the server enforces. */
const inputSchema = (schema: z.ZodType) => z.toJSONSchema(schema, { io: "input" }) as Record<string, unknown>;

const TOOLS = [
  {
    name: "taste_check",
    title: "Taste-check cultural picks against an audience (Qloo)",
    description:
      "Score a list of cultural picks (artists, brands, shows, films, podcasts, venues, creators, cities) against an audience defined by what it already loves and its age buckets. Returns, per pick, a verdict (pass; miss; hallucination = not found in Qloo by a typed or an untyped search; fading; unscored = no Qloo score to judge by), Qloo affinity, the pass bar, explainability and the Qloo calls behind it, plus Qloo-preferred replacements for failures.",
    inputSchema: inputSchema(TasteCheckArgs),
  },
  {
    name: "plan_campaign",
    title: "Plan a Qloo-verified launch campaign",
    description: `Run the full Tastemaker agent: audience profile, launch city, cross-domain picks, hooks, script and captions, with every cultural pick verified by Qloo, plus the same model's plan without Qloo for comparison. Pass {"preset": one of ${PRESETS.map((p) => `"${p.id}"`).join(", ")}} or {"brief": {...}}.`,
    inputSchema: inputSchema(RunRequest),
  },
];

type JsonRpcId = string | number | null;

/** A JSON-RPC 2.0 request or notification; anything else is answered with -32600. */
const JsonRpcMessage = z.object({
  jsonrpc: z.literal("2.0"),
  id: z.union([z.string(), z.number()]).optional(),
  method: z.string().min(1),
  params: z.record(z.string(), z.unknown()).optional(),
});
type JsonRpcMessage = z.infer<typeof JsonRpcMessage>;

const ok = (id: JsonRpcId, result: unknown) => ({ jsonrpc: "2.0" as const, id, result });
const fail = (id: JsonRpcId, code: number, message: string) => ({ jsonrpc: "2.0" as const, id, error: { code, message } });
type RpcReply = ReturnType<typeof ok> | ReturnType<typeof fail>;

function receiptLine(r: Receipt) {
  const aff = r.affinity !== undefined ? ` affinity ${r.affinity.toFixed(2)}${r.threshold !== undefined ? ` (bar ${r.threshold.toFixed(2)})` : ""}` : "";
  return `- [${r.verdict}] ${r.role}: ${r.name}${aff}${r.replaced ? ` — replaced ${r.replaced.name}` : ""}. ${r.note}`;
}

/** Admits a paid (uncached, live) tool call, or says why not. */
type Gate = () => Promise<GuardResult>;

class RpcError extends Error {
  constructor(
    readonly code: number,
    message: string,
  ) {
    super(message);
    this.name = "RpcError";
  }
}

class ToolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ToolError";
  }
}

async function tasteCheckTool(args: unknown, gate: Gate) {
  const a = TasteCheckArgs.parse(args);
  const qloo = qlooFromEnv();
  // Only calls that would spend live Qloo quota are rate-limited.
  if (qloo.primarySource === "live") await admitOrThrow(gate);
  const r = await tasteCheck(a, { qloo });
  const text = [
    `Qloo taste check (${r.sources.join(", ")} data): ${r.metrics.hallucinations} not found in Qloo, ${r.metrics.misses} low-affinity, ${r.metrics.fading} fading, ${r.metrics.unscored} unscored, of ${r.metrics.picks}.${r.sources.includes("simulated") ? " Simulated data: the numbers are placeholders, not Qloo data." : ""}`,
    ...r.receipts.map(receiptLine),
    ...(r.suggestions.length ? ["Qloo-preferred replacements:", ...r.suggestions.map((s) => `- ${s.from} → ${s.to}: ${s.reason}`)] : []),
    ...(r.warnings.length ? [`Warnings: ${r.warnings.join("; ")}`] : []),
  ].join("\n");
  return { content: [{ type: "text", text }], structuredContent: r };
}

async function admitOrThrow(gate: Gate) {
  const g = await gate();
  if (!g.ok) throw new ToolError(g.message);
}

async function planCampaignTool(args: unknown, gate: Gate) {
  const request = resolveRunRequest(args ?? {});
  if (!request.ok) throw new ToolError(request.status === 400 ? `Invalid arguments: ${request.error}` : request.error);
  const lookup = await cachedRun(request.brief);
  if (!lookup.result && costsMoney(lookup.deps)) await admitOrThrow(gate);
  const { result: r } = await getOrRun(lookup);
  const text = [
    `${r.brief.subject} — ${r.brief.product}. Qloo data: ${r.sources.join(", ")}. Model: ${r.llm.label}.`,
    placeholderReason(r) ?? `Culture Miss Rate: without Qloo ${Math.round(r.metrics.baseline.cultureMissRate * 100)}%, with Qloo ${Math.round(r.metrics.grounded.cultureMissRate * 100)}%.`,
    `Positioning: ${r.grounded.draft.positioning}`,
    "Hooks:",
    ...r.grounded.draft.hooks.map((h) => `- ${h}`),
    "Verified picks:",
    ...r.grounded.receipts.map(receiptLine),
  ].join("\n");
  return {
    content: [{ type: "text", text }],
    structuredContent: { id: r.id, sources: r.sources, metrics: r.metrics, draft: r.grounded.draft, receipts: r.grounded.receipts, cities: r.cities.slice(0, 5) },
  };
}

async function callTool(name: string, args: unknown, gate: Gate) {
  if (name === "taste_check") return tasteCheckTool(args, gate);
  if (name === "plan_campaign") return planCampaignTool(args, gate);
  throw new RpcError(-32602, `Unknown tool "${name}"`);
}

const toolErrorText = (err: unknown) =>
  err instanceof z.ZodError
    ? `Invalid arguments: ${formatZodIssues(err, { root: "arguments" })}`
    : err instanceof ToolError
      ? err.message
      : "The tool failed; try again shortly.";

/**
 * Handle one JSON-RPC message. Returns undefined for notifications (no reply
 * is sent for them, whatever the method).
 */
export async function handleRpc(raw: unknown, gate: Gate = () => Promise.resolve({ ok: true })): Promise<RpcReply | undefined> {
  const parsed = JsonRpcMessage.safeParse(raw);
  if (!parsed.success) {
    const id = typeof raw === "object" && raw !== null && "id" in raw && (typeof raw.id === "string" || typeof raw.id === "number") ? raw.id : null;
    return fail(id, -32600, "Invalid Request");
  }
  const msg: JsonRpcMessage = parsed.data;
  if (msg.id === undefined) return undefined;
  const id = msg.id;
  try {
    switch (msg.method) {
      case "initialize": {
        const asked = typeof msg.params?.protocolVersion === "string" ? msg.params.protocolVersion : "";
        return ok(id, {
          protocolVersion: SUPPORTED_VERSIONS.includes(asked) ? asked : SUPPORTED_VERSIONS[0],
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: "tastemaker", title: "Tastemaker by Sigmora", version: "0.1.0" },
          instructions: "Use taste_check to verify any cultural pick (artist, brand, show, podcast, venue, creator) against an audience before you recommend it. Results are aggregate audience affinity from Qloo.",
        });
      }
      case "ping":
        return ok(id, {});
      case "tools/list":
        return ok(id, { tools: TOOLS });
      case "tools/call": {
        const name = typeof msg.params?.name === "string" ? msg.params.name : "";
        try {
          return ok(id, await callTool(name, msg.params?.arguments, gate));
        } catch (err) {
          if (err instanceof RpcError) throw err;
          if (!(err instanceof z.ZodError) && !(err instanceof ToolError)) console.error(`[mcp] ${name}: ${(err as Error).message}`);
          return ok(id, { content: [{ type: "text", text: toolErrorText(err) }], isError: true });
        }
      }
      default:
        throw new RpcError(-32601, `Method not found: ${msg.method}`);
    }
  } catch (err) {
    if (err instanceof RpcError) return fail(id, err.code, err.message);
    console.error(`[mcp] ${msg.method}: ${(err as Error).message}`);
    return fail(id, -32603, "Internal error");
  }
}
