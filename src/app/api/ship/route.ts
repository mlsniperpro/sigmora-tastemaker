import { z } from "zod";
import { checkGuard, clientIp } from "@/lib/guard";
import { ShipRequest, publisherFromEnv } from "@/lib/publisher";

export async function POST(req: Request) {
  let body: ShipRequest;
  try {
    body = ShipRequest.parse(await req.json());
  } catch (err) {
    const message = err instanceof z.ZodError ? err.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") : "Invalid JSON";
    return Response.json({ error: message }, { status: 400 });
  }
  const publisher = publisherFromEnv();
  if (publisher.id === "sigmora") {
    const g = checkGuard(clientIp(req.headers));
    if (!g.ok) return Response.json({ error: g.message }, { status: g.status });
  }
  try {
    return Response.json(await publisher.ship(body));
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : "Ship failed" }, { status: 502 });
  }
}
