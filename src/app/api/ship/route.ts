import { keepShippedRun, runById, shippableByOwner } from "@/lib/agent/runCache";
import { admit, floodGuard, guardResponse } from "@/lib/guard";
import { ShipRequest, publisherForRequest } from "@/lib/publisher";
import { crossSiteResponse, sameOrigin } from "@/lib/publisher/owner";
import { qlooFromEnv } from "@/lib/qloo/client";
import { formatZodIssues } from "@/lib/zod";

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
  const body = ShipRequest.safeParse(json);
  if (!body.success) return Response.json({ error: formatZodIssues(body.error, { root: "body" }) }, { status: 400 });
  const run = await runById(body.data.runId);
  if (!run) return Response.json({ error: "Unknown or expired run. Run the plan again, then ship." }, { status: 404 });

  // Picks the critic still flags are shown to the user first; shipping them needs an explicit yes.
  const flagged = run.grounded.receipts.filter((r) => r.verdict === "miss" || r.verdict === "hallucination" || r.verdict === "fading");
  if (flagged.length && !body.data.acceptFlagged) {
    return Response.json(
      { error: "Some picks still failed the Qloo critic.", flagged: flagged.map((r) => ({ name: r.name, role: r.role, verdict: r.verdict, note: r.note })) },
      { status: 409 },
    );
  }

  const publisher = await publisherForRequest(req);
  if (publisher instanceof Response) return publisher;
  // On a deployment with live Qloo, a simulated run is a fallback (live Qloo failed or was refused): its picks were never checked.
  if (publisher.id === "sigmora" && run.qloo.simulated > 0 && qlooFromEnv().primarySource === "live") {
    return Response.json({ error: "This run is the offline simulator, shown because live Qloo was unavailable; its picks weren't checked against Qloo. Run it again live, then ship." }, { status: 409 });
  }
  if (publisher.id === "sigmora" && !(await shippableByOwner(run))) {
    return Response.json({ error: "Only preset runs and runs you started while signed in as the owner can ship to real channels." }, { status: 403 });
  }
  const g = await admit(req, { costs: publisher.id === "sigmora" });
  if (!g.ok) return guardResponse(g);
  try {
    const receipt = await publisher.ship({
      runId: run.id,
      subject: run.brief.subject,
      posts: run.grounded.draft.captions,
      verifiedPicks: run.grounded.receipts.filter((r) => r.verdict === "pass").map((r) => r.name),
      flaggedPicks: flagged.map((r) => r.name),
      assets: { positioning: run.grounded.draft.positioning, hooks: run.grounded.draft.hooks, script: run.grounded.draft.script, musicBrief: run.grounded.draft.musicBrief },
      startDate: body.data.startDate,
    });
    if (receipt.publisher === "sigmora") await keepShippedRun(run);
    return Response.json(receipt);
  } catch (err) {
    console.error(`[ship] ${(err as Error).message}`);
    return Response.json({ error: "The publisher didn't accept the campaign. Try again in a minute." }, { status: 502 });
  }
}
