import { AUDIT_CALL_ESTIMATE, AuditRequest, auditKey, auditPlan, cachedAudit, storeAudit } from "@/lib/agent/audit";
import { defaultCache } from "@/lib/qloo/cache";
import { NoSeedError } from "@/lib/agent/context";
import { admit, clientIp, floodGuard, guardResponse, qlooBudget, qlooRefusal } from "@/lib/guard";
import { llmFromEnv } from "@/lib/llm";
import { crossSiteResponse, sameOrigin } from "@/lib/publisher/owner";
import { qlooFromEnv } from "@/lib/qloo/client";
import { isQlooStop } from "@/lib/qloo/errors";
import { formatZodIssues } from "@/lib/zod";

export const maxDuration = 60;

/** No Qloo call is sent this long after the request starts, so the reply beats the route's limit. */
const QLOO_DEADLINE_MS = 45_000;

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
  const body = AuditRequest.safeParse(json);
  if (!body.success) return Response.json({ error: formatZodIssues(body.error, { root: "body" }) }, { status: 400 });

  const qloo = qlooFromEnv();
  const llm = llmFromEnv();
  const live = qloo.primarySource === "live";
  // An identical audit already ran: serve it, before any budget is reserved or limit counted.
  const cache = defaultCache();
  const key = auditKey(body.data, llm.id, qloo.primarySource);
  const hit = await cachedAudit(cache, key);
  if (hit) return Response.json(hit);
  // Budget first: only an audit that got its Qloo calls counts toward the rate limits and the daily cap.
  if (live && !(await qloo.reserve(AUDIT_CALL_ESTIMATE, qlooBudget({ fresh: true }, clientIp(req.headers))))) return guardResponse(qlooRefusal(qloo.refusedBy));
  const g = await admit(req, { costs: live || !llm.scripted });
  if (!g.ok) {
    await qloo.release();
    return guardResponse(g);
  }
  qloo.setDeadline(Date.now() + QLOO_DEADLINE_MS);
  try {
    const result = await auditPlan(body.data, { qloo, llm });
    await storeAudit(cache, key, result);
    return Response.json(result);
  } catch (err) {
    if (err instanceof NoSeedError) return Response.json({ error: "None of the audience's names resolved in Qloo; try other names they love." }, { status: 422 });
    if (isQlooStop(err)) return Response.json({ error: `The audit ran out of Qloo budget or time (${err.message}). Try a shorter plan.` }, { status: 503 });
    console.error(`[audit] ${err instanceof Error ? err.message : String(err)}`);
    return Response.json({ error: "The audit failed; try again shortly." }, { status: 502 });
  } finally {
    await qloo.release();
  }
}
