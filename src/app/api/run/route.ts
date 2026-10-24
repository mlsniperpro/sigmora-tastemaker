import { cachedRun, costsMoney, getOrRun, resolveRunRequest } from "@/lib/agent/runCache";
import type { RunEvent } from "@/lib/agent/types";
import { admit, guardResponse } from "@/lib/guard";

// A live run is throttled to the Qloo key's rate (~54 calls at 4/s) plus up to four model calls.
export const maxDuration = 120;

/**
 * POST /api/run → NDJSON stream of RunEvent lines: one "step" per trace step
 * as it completes, then one "result" (or "error").
 */
export async function POST(req: Request) {
  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return Response.json({ error: "Body must be JSON" }, { status: 400 });
  }
  const request = resolveRunRequest(json);
  if (!request.ok) return Response.json({ error: request.error }, { status: request.status });

  const lookup = await cachedRun(request.brief);
  // Presets skip the per-IP limit so the one-click demo always works; they still count toward the daily cap.
  const g = await admit(req, { costs: !lookup.result && costsMoney(lookup.deps), perIp: !request.preset });
  if (!g.ok) return guardResponse(g);

  const enc = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      // If the client goes away, keep running so the result still gets cached; just stop writing.
      let open = true;
      const send = (e: RunEvent) => {
        if (!open) return;
        try {
          controller.enqueue(enc.encode(JSON.stringify(e) + "\n"));
        } catch {
          open = false;
        }
      };
      try {
        await getOrRun(lookup, send);
      } catch (err) {
        send({ type: "error", message: err instanceof Error ? err.message : "Run failed" });
      } finally {
        if (open) {
          try {
            controller.close();
          } catch {
            // already closed by a cancelled reader
          }
        }
      }
    },
  });
  return new Response(stream, {
    headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store", "X-Run-Cache": lookup.result ? "hit" : "miss" },
  });
}
