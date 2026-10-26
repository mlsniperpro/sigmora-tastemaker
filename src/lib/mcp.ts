/**
 * Tastemaker as an MCP server (Streamable HTTP, stateless JSON responses), so
 * any agent can call "taste-check this campaign". Implements the subset of
 * MCP a tool server needs: initialize, ping, tools/list, tools/call.
 */
import { z } from "zod";
import { BriefFields, PICK_TYPES, ROLES } from "./agent/brief";
import { PRESETS } from "./agent/presets";
import { RunRequest } from "./agent/brief";
import { formatRate, placeholderReason } from "./agent/evidence";
import { cachedRun, costsMoney, getOrRun, recordedRuns, resolveRunRequest } from "./agent/runCache";
import { tasteCheck } from "./agent/tasteCheck";
import { AuditRequest, auditWithBudget } from "./agent/audit";
import { NoSeedError } from "./agent/context";
import { llmFromEnv } from "./llm";
import { defaultCache } from "./qloo/cache";
import { isQlooStop } from "./qloo/errors";
import type { Receipt } from "./agent/types";
import { loadConfig } from "./config";
import { qlooBudget, qlooRefusal, refundAdmissionFor, type GuardResult } from "./guard";
import { qlooFromEnv, type QlooClient, type ReserveOptions } from "./qloo/client";
import { MALFORMED_TEXT, formatZodIssues, hasLoneSurrogate } from "./zod";

export const SUPPORTED_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"];

/** Audience fields reuse the Brief's own rules, so the limits can't drift. */
const TasteCheckArgs = BriefFields.pick({ ages: true, gender: true })
  .extend({
    seeds: BriefFields.shape.seeds.min(1),
    city: BriefFields.shape.targetCity.describe("Launch city: a city pick must match it, and venue picks must be in it"),
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
    name: "audit_plan",
    title: "Audit any AI's campaign plan against an audience (Qloo)",
    description:
      "Paste a marketing plan written by any model or person, plus the audience (names it already loves, age buckets). Every cultural name in the text is found and checked by the Qloo critic: names Qloo can't find come back as hallucination, weak picks as miss with Qloo-preferred replacements. Identical audits are served from cache.",
    inputSchema: inputSchema(AuditRequest),
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

async function tasteCheckTool(args: unknown, gate: Gate, ip: string) {
  const a = TasteCheckArgs.parse(args);
  const qloo = qlooFromEnv();
  // Only calls that would spend live Qloo quota are rate-limited, and they reserve their calls first
  // (about two per pick to resolve and score, plus the role pools and trend checks).
  if (qloo.primarySource === "live") await reserveThenAdmit(qloo, 2 * a.picks.length + 12, qlooBudget({ fresh: true }, ip), gate);
  const r = await tasteCheck(a, { qloo }).finally(() => qloo.release());
  const text = [
    `Qloo taste check (${r.sources.join(", ")} data): ${r.metrics.hallucinations} not found in Qloo, ${r.metrics.misses} low-affinity, ${r.metrics.fading} fading, ${r.metrics.unscored} unscored, of ${r.metrics.picks}.${r.sources.includes("simulated") ? " Simulated data: the numbers are placeholders, not Qloo data." : ""}`,
    ...r.receipts.map(receiptLine),
    ...(r.suggestions.length ? ["Qloo-preferred replacements:", ...r.suggestions.map((s) => `- ${s.from} → ${s.to}: ${s.reason}`)] : []),
    ...(r.warnings.length ? [`Warnings: ${r.warnings.join("; ")}`] : []),
  ].join("\n");
  return { content: [{ type: "text", text }], structuredContent: r };
}

/** As in /api/run: the Qloo budget first, so only a call that got its budget counts toward the rate limits and the daily cap. */
async function reserveThenAdmit(qloo: QlooClient, calls: number, budget: ReserveOptions, gate: Gate) {
  if (!(await qloo.reserve(calls, budget))) throw new ToolError(qlooRefusal(qloo.refusedBy).message);
  const g = await gate();
  if (g.ok) return;
  await qloo.release();
  throw new ToolError(g.message);
}

async function planCampaignTool(args: unknown, gate: Gate, ip: string) {
  const request = resolveRunRequest(args ?? {});
  if (!request.ok) throw new ToolError(request.status === 400 ? `Invalid arguments: ${request.error}` : request.error);
  const cached = await cachedRun(request.brief);
  // As in /api/run: "fresh" means live, so a cached result doesn't answer it.
  const lookup = request.fresh ? { ...cached, result: undefined } : cached;
  const recording = request.presetId ? recordedRuns().get(request.presetId) : undefined;
  let r;
  if (!lookup.result && recording && !request.fresh) r = recording;
  else {
    const paid = !lookup.result && costsMoney(lookup.deps);
    if (paid) await reserveThenAdmit(lookup.deps.qloo, loadConfig().QLOO_RUN_ESTIMATE, qlooBudget(request, ip), gate);
    r = (
      await getOrRun(lookup, undefined, recording)
        .catch(async (err: unknown) => {
          // No audience name resolved: the run spent nothing, so it doesn't count toward the limits.
          if (paid && err instanceof NoSeedError) await refundAdmissionFor(ip);
          throw err;
        })
        .finally(() => lookup.deps.qloo.release())
    ).result;
  }
  const text = [
    `${r.brief.subject} — ${r.brief.product}. Qloo data: ${r.sources.join(", ")}. Model: ${r.llm.label}.`,
    placeholderReason(r) ?? `Culture Miss Rate: without Qloo ${formatRate(r.metrics.baseline.cultureMissRate)}, with the Qloo critic ${formatRate(r.metrics.grounded.cultureMissRate)} (its bar comes from Qloo's own candidates, so this is low by design).`,
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

async function auditPlanTool(args: unknown, gate: Gate, ip: string) {
  const input = AuditRequest.parse(args);
  let outcome;
  try {
    outcome = await auditWithBudget(input, { qloo: qlooFromEnv(), llm: llmFromEnv(), cache: defaultCache(), ip, gate, refund: () => refundAdmissionFor(ip) });
  } catch (err) {
    if (err instanceof NoSeedError) throw new ToolError("None of the audience's names resolved in Qloo; try other names they love.");
    if (isQlooStop(err)) throw new ToolError(`The audit ran out of Qloo budget or time (${err.message}).`);
    throw err;
  }
  if (!outcome.ok) throw new ToolError(outcome.refusal.message);
  const r = outcome.result;
  const text = [
    r.simulated
      ? `${String(r.receipts.length)} names checked by the offline simulator (no Qloo key on this server): verdicts are placeholders, not Qloo data.`
      : `Qloo audit: ${String(r.metrics.hallucinations)} not found in Qloo, ${String(r.metrics.misses)} low-affinity, ${String(r.metrics.fading)} fading, ${String(r.metrics.unscored)} unscored, of ${String(r.metrics.picks)}.${r.cached ? " (cached)" : ""}`,
    ...r.receipts.map(receiptLine),
    ...(r.suggestions.length ? ["Qloo-preferred replacements:", ...r.suggestions.map((x) => `- ${x.from} → ${x.to}: ${x.reason}`)] : []),
    ...(r.extraction.unmatched?.length ? [`Not audited (no entity by that exact name): ${r.extraction.unmatched.join(", ")}`] : []),
  ].join("\n");
  return { content: [{ type: "text", text }], structuredContent: r };
}

async function callTool(name: string, args: unknown, gate: Gate, ip: string) {
  if (hasLoneSurrogate(args)) throw new ToolError(MALFORMED_TEXT);
  if (name === "taste_check") return tasteCheckTool(args, gate, ip);
  if (name === "audit_plan") return auditPlanTool(args, gate, ip);
  if (name === "plan_campaign") return planCampaignTool(args, gate, ip);
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
/** `ip` is the caller's rate-limit key: its daily share of the Qloo budget is reserved under it. */
export async function handleRpc(raw: unknown, gate: Gate = () => Promise.resolve({ ok: true }), ip = "unknown"): Promise<RpcReply | undefined> {
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
          return ok(id, await callTool(name, msg.params?.arguments, gate, ip));
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
