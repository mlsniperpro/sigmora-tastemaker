import { loadConfig } from "@/lib/config";
import { checkGuard, clientIp, floodGuard } from "@/lib/guard";
import { SUPPORTED_VERSIONS, handleRpc } from "@/lib/mcp";

export const maxDuration = 120;

const rpcError = (code: number, message: string, status: number) =>
  Response.json({ jsonrpc: "2.0", id: null, error: { code, message } }, { status });

/**
 * Browsers send Origin; server-side MCP clients don't. Cross-origin browser calls need an allow-list entry.
 * (A rebound host looks same-origin here; the endpoint holds no credentials or session, so that reaches nothing a direct call can't.)
 */
function originAllowed(req: Request): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return true;
  if (origin === new URL(req.url).origin) return true;
  const allowed = (loadConfig().MCP_ALLOWED_ORIGINS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  return allowed.includes(origin);
}

/**
 * MCP Streamable HTTP endpoint (spec 2025-06-18): stateless, one JSON-RPC
 * message per POST, JSON responses (no SSE), 202 for notifications.
 */
export async function POST(req: Request) {
  if (!originAllowed(req)) return rpcError(-32600, "Origin not allowed", 403);
  if (await floodGuard(req)) return rpcError(-32000, "Too many requests from your network. Wait a minute.", 429);
  const version = req.headers.get("mcp-protocol-version");
  if (version && !SUPPORTED_VERSIONS.includes(version)) return rpcError(-32600, `Unsupported MCP-Protocol-Version ${version}`, 400);
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return rpcError(-32700, "Parse error", 400);
  }
  // JSON-RPC batching was removed from MCP in 2025-06-18.
  if (Array.isArray(body)) return rpcError(-32600, "Batch requests are not supported", 400);
  const ip = clientIp(req.headers);
  const reply = await handleRpc(body, () => checkGuard(ip), ip);
  if (!reply) return new Response(null, { status: 202 });
  return Response.json(reply);
}

export function GET() {
  return new Response("Tastemaker MCP endpoint: POST one JSON-RPC message (Streamable HTTP, stateless). Tools: taste_check, audit_plan, plan_campaign.", {
    status: 405,
    headers: { Allow: "POST" },
  });
}
