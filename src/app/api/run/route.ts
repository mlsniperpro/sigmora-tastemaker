import { after } from "next/server";
import { cachedRun, costsMoney, getOrRun, recordedRuns, replay, resolveRunRequest, runById } from "@/lib/agent/runCache";
import type { RunEvent } from "@/lib/agent/types";
import { admit, guardResponse } from "@/lib/guard";

// A live run is throttled to the Qloo key's rate (~52 calls at 4/s for the hero preset) plus up to four model calls.
export const maxDuration = 120;

const NDJSON = { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store" };

/** Streams events written by `work`; if the client goes away, the work carries on (so the result still gets cached). */
function ndjson(work: (send: (e: RunEvent) => void) => Promise<unknown>, headers: Record<string, string> = {}): Response {
  const enc = new TextEncoder();
  let finished: Promise<unknown> = Promise.resolve();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const client = { open: true };
      const send = (e: RunEvent) => {
        if (!client.open) return;
        try {
          controller.enqueue(enc.encode(JSON.stringify(e) + "\n"));
        } catch {
          client.open = false;
        }
      };
      finished = work(send)
        .catch((err: unknown) => {
          send({ type: "error", message: err instanceof Error ? err.message : "Run failed" });
        })
        .finally(() => {
          if (!client.open) return;
          try {
            controller.close();
          } catch {
            // already closed by a cancelled reader
          }
        });
    },
  });
  try {
    // Keep the function alive until the run is stored, even if the client disconnects.
    after(() => finished);
  } catch {
    // Outside a Next request scope (tests, scripts) there is no lifetime to extend.
  }
  return new Response(stream, { headers: { ...NDJSON, ...headers } });
}

/**
 * POST /api/run → NDJSON stream of RunEvent lines: "start"/"step" per trace
 * step, then one "result" (or "error"). A preset with a recorded live run is
 * served from the recording instantly unless `fresh` is set; the recording
 * also covers a refused or failed live run.
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
  const recording = request.presetId ? recordedRuns().get(request.presetId) : undefined;
  if (!lookup.result && recording && !request.fresh) {
    return ndjson((send) => Promise.resolve(replay(recording, { from: "recording" }, send)), { "X-Run-Cache": "recording" });
  }
  // Presets skip the per-IP limit so the one-click demo always works; they still count toward the daily cap.
  const g = await admit(req, { costs: !lookup.result && costsMoney(lookup.deps), perIp: !request.presetId });
  if (!g.ok) {
    if (!recording) return guardResponse(g);
    const reason = `a live run was refused (${g.message})`;
    return ndjson((send) => Promise.resolve(replay(recording, { from: "recording", reason }, send)), { "X-Run-Cache": "recording" });
  }
  return ndjson((send) => getOrRun(lookup, send, recording), { "X-Run-Cache": lookup.result ? "hit" : "miss" });
}

/** GET /api/run?id=<run id> → the finished run as JSON (permalinks). */
export async function GET(req: Request) {
  const id = new URL(req.url).searchParams.get("id") ?? "";
  if (!/^[a-z0-9]{1,40}$/.test(id)) return Response.json({ error: "Bad run id" }, { status: 400 });
  const result = await runById(id);
  return result ? Response.json({ result }, { headers: { "Cache-Control": "public, max-age=300" } }) : Response.json({ error: "This run has expired or never existed." }, { status: 404 });
}
