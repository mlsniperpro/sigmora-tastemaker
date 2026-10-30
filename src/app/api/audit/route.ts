import { AuditRequest, auditWithBudget } from "@/lib/agent/audit";
import { defaultCache } from "@/lib/qloo/cache";
import { NoSeedError } from "@/lib/agent/context";
import { admit, clientIp, floodGuard, guardResponse, refundAdmission, unmeteredAllowed } from "@/lib/guard";
import { llmFromEnv } from "@/lib/llm";
import { crossSiteResponse, sameOrigin } from "@/lib/publisher/owner";
import { qlooFromEnv } from "@/lib/qloo/client";
import { isQlooStop } from "@/lib/qloo/errors";
import { MALFORMED_TEXT, formatZodIssues, hasLoneSurrogate } from "@/lib/zod";

export const maxDuration = 60;

/**
 * Audit any AI's plan: POST { text, seeds, ages, gender?, city? }. Every
 * cultural entity in the text is found (the live model, else the
 * deterministic scanner) and judged by the Qloo critic against the audience.
 * Only requests that spend live Qloo or model calls are rate-limited, and
 * their Qloo calls are reserved first, like MCP's taste_check.
 */
export async function POST(req: Request) {
  if (!sameOrigin(req)) return crossSiteResponse();
  const flood = await floodGuard(req);
  if (flood) return flood;
  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return Response.json({ error: "Body must be JSON" }, { status: 400 });
  }
  if (hasLoneSurrogate(json)) return Response.json({ error: MALFORMED_TEXT }, { status: 400 });
  const body = AuditRequest.safeParse(json);
  if (!body.success) return Response.json({ error: formatZodIssues(body.error, { root: "body" }) }, { status: 400 });

  try {
    const outcome = await auditWithBudget(body.data, { qloo: qlooFromEnv(), llm: llmFromEnv(), cache: defaultCache(), ip: clientIp(req.headers), gate: () => admit(req, { costs: true }), refund: () => refundAdmission(req), unmetered: () => unmeteredAllowed(clientIp(req.headers)) });
    return outcome.ok ? Response.json(outcome.result) : guardResponse(outcome.refusal);
  } catch (err) {
    if (err instanceof NoSeedError) return Response.json({ error: "None of the audience's names resolved in Qloo; try other names they love." }, { status: 422 });
    if (isQlooStop(err)) return Response.json({ error: `The audit ran out of Qloo budget or time (${err.message}). Try a shorter plan.` }, { status: 503 });
    console.error(`[audit] ${err instanceof Error ? err.message : String(err)}`);
    return Response.json({ error: "The audit failed; try again shortly." }, { status: 502 });
  }
}
