import { runById } from "@/lib/agent/runCache";
import { admit, guardResponse } from "@/lib/guard";
import { ShipRequest, publisherFromEnv } from "@/lib/publisher";
import { formatZodIssues } from "@/lib/zod";

export async function POST(req: Request) {
  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return Response.json({ error: "Body must be JSON" }, { status: 400 });
  }
  const body = ShipRequest.safeParse(json);
  if (!body.success) return Response.json({ error: formatZodIssues(body.error, { root: "body" }) }, { status: 400 });
  const run = await runById(body.data.runId);
  if (!run) return Response.json({ error: "Unknown or expired run. Run the plan again, then ship." }, { status: 404 });

  const publisher = publisherFromEnv();
  const g = await admit(req, { costs: publisher.id === "sigmora" });
  if (!g.ok) return guardResponse(g);
  try {
    const receipt = await publisher.ship({
      runId: run.id,
      subject: run.brief.subject,
      posts: run.grounded.draft.captions,
      verifiedPicks: run.grounded.receipts.filter((r) => r.verdict === "pass").map((r) => r.name),
      startDate: body.data.startDate,
    });
    return Response.json(receipt);
  } catch (err) {
    console.error(`[ship] ${(err as Error).message}`);
    return Response.json({ error: "The publisher didn't accept the campaign. Try again in a minute." }, { status: 502 });
  }
}
