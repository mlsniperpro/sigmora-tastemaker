import { after } from "next/server";
import { cachedRun, costsMoney, getOrRun, lastRun, markOwnerRun, recordedRuns, replay, resolveRunRequest, runById, type Lookup, type ResolvedRequest } from "@/lib/agent/runCache";
import type { RunEvent, Served } from "@/lib/agent/types";
import { loadConfig } from "@/lib/config";
import { isOwnerRequest } from "@/lib/publisher";
import { QLOO_SPENT, admit, clientIp, floodGuard, guardResponse, qlooBudget, type GuardResult } from "@/lib/guard";
import { crossSiteResponse, sameOrigin } from "@/lib/publisher/owner";

// A live run is throttled to the Qloo key's rate (the hero preset makes ~76 calls at 4/s with the scripted model; `pnpm demo` prints the count) plus up to four model calls.
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
  // A cross-site page could otherwise make its visitors spend this demo's budget.
  if (!sameOrigin(req)) return crossSiteResponse();
  const flood = await floodGuard(req);
  if (flood) return flood;
  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return Response.json({ error: "Body must be JSON" }, { status: 400 });
  }
  const request = resolveRunRequest(json);
  if (!request.ok) return Response.json({ error: request.error }, { status: request.status });

  const cached = await cachedRun(request.brief);
  // "Re-run live" means live: a cached result for the preset doesn't answer it.
  const lookup = request.fresh ? { ...cached, result: undefined } : cached;
  const recording = request.presetId ? recordedRuns().get(request.presetId) : undefined;
  if (!lookup.result && recording && !request.fresh) {
    return ndjson((send) => Promise.resolve(replay(recording, { from: "recording" }, send)), { "X-Run-Cache": "recording" });
  }
  const refusal = !lookup.result && costsMoney(lookup.deps) ? await admitNewRun(req, request, lookup) : undefined;
  if (refusal) {
    // A refused run shows the preset's recording, else this brief's last finished run, labelled with why.
    const fallback = recording ?? (await lastRun(lookup));
    if (!fallback) return guardResponse(refusal);
    const served: Served = { from: fallback === recording ? "recording" : "cache", reason: `a new live run was refused (${refusal.message})` };
    return ndjson((send) => Promise.resolve(replay(fallback, served, send)), { "X-Run-Cache": served.from });
  }
  const owner = isOwnerRequest(req.headers);
  const work = async (send: (e: RunEvent) => void) => {
    const out = await getOrRun(lookup, send, recording).finally(() => lookup.deps.qloo.release());
    // The owner was served this run from their own brief, so it may ship to real channels.
    if (owner) await markOwnerRun(out.result.id, lookup.deps.cache);
    return out;
  };
  return ndjson(work, { "X-Run-Cache": lookup.result ? "hit" : "miss" });
}

/**
 * Admits a new paid run, or says why not. Its Qloo calls are reserved first
 * (each caller, or each cold preset, has its own daily share), and only a run
 * that got its budget counts toward the rate limits and the daily run cap, so
 * refused requests can't use up the cap for everyone.
 */
async function admitNewRun(req: Request, request: Extract<ResolvedRequest, { ok: true }>, lookup: Lookup): Promise<Extract<GuardResult, { ok: false }> | undefined> {
  if (!(await lookup.deps.qloo.reserve(loadConfig().QLOO_RUN_ESTIMATE, qlooBudget(request, clientIp(req.headers))))) return QLOO_SPENT;
  // Presets skip the per-IP limits so the one-click demo always works ("Re-run live" doesn't); they still count toward the daily cap.
  const g = await admit(req, { costs: true, perIp: !request.presetId || request.fresh });
  if (g.ok) return undefined;
  await lookup.deps.qloo.release();
  return g;
}

/** GET /api/run?id=<run id> → the finished run as JSON (permalinks). */
export async function GET(req: Request) {
  const flood = await floodGuard(req);
  if (flood) return flood;
  const id = new URL(req.url).searchParams.get("id") ?? "";
  if (!/^[a-z0-9]{1,40}$/.test(id)) return Response.json({ error: "Bad run id" }, { status: 400 });
  const result = await runById(id);
  return result ? Response.json({ result }, { headers: { "Cache-Control": "public, max-age=300" } }) : Response.json({ error: "This run has expired or never existed." }, { status: 404 });
}
