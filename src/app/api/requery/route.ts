import { requeryBrief } from "@/lib/agent/requery";
import { runById } from "@/lib/agent/runCache";
import { admit, floodGuard, guardResponse } from "@/lib/guard";
import { HttpError } from "@/lib/net";
import { MeasureRequest, MetricsUnavailableError, publisherForRequest } from "@/lib/publisher";
import { crossSiteResponse, sameOrigin } from "@/lib/publisher/owner";
import { formatZodIssues } from "@/lib/zod";

/** Measure a shipped campaign and return the next brief, seeded with the picks that performed. The client then runs it. */
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
  const body = MeasureRequest.safeParse(json);
  if (!body.success) return Response.json({ error: formatZodIssues(body.error, { root: "body" }) }, { status: 400 });

  const publisher = await publisherForRequest(req);
  if (publisher instanceof Response) return publisher;
  const g = await admit(req, { costs: publisher.id === "sigmora" });
  if (!g.ok) return guardResponse(g);
  try {
    const metrics = await publisher.metrics(body.data.campaignId);
    const run = await runById(metrics.runId);
    if (!run) return Response.json({ error: "The run behind this campaign has expired." }, { status: 404 });
    const next = requeryBrief(run, metrics.posts);
    return next.ok ? Response.json(next) : Response.json({ error: next.reason }, { status: 409 });
  } catch (err) {
    if (err instanceof MetricsUnavailableError) return Response.json({ error: err.message }, { status: 409 });
    if (err instanceof HttpError && err.status === 404) return Response.json({ error: "Sigmora doesn't know that campaign." }, { status: 404 });
    console.error(`[requery] ${err instanceof Error ? err.message : String(err)}`);
    return Response.json({ error: "Couldn't read the campaign's performance. Try again in a minute." }, { status: 502 });
  }
}
