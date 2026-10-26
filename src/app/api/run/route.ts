import { after } from "next/server";
import { MALFORMED_TEXT, hasLoneSurrogate } from "@/lib/zod";
import { cachedRun, costsMoney, getOrRun, isInFlight, keepFallbackRun, lastRun, markOwnerRun, recordedRuns, replay, resolveRunRequest, runById, servedAs, type Lookup, type ResolvedRequest } from "@/lib/agent/runCache";
import type { Brief } from "@/lib/agent/brief";
import type { RunEvent, RunResult, Served } from "@/lib/agent/types";
import { loadConfig } from "@/lib/config";
import { isOwnerRequest } from "@/lib/publisher";
import { admit, clientIp, floodGuard, guardResponse, qlooBudget, qlooRefusal, refundAdmission, unmeteredGuard, type GuardResult } from "@/lib/guard";
import { HttpError } from "@/lib/net";
import { NoSeedError } from "@/lib/agent/context";
import { runTastemaker } from "@/lib/agent/run";
import { DeterministicLLM } from "@/lib/llm/deterministic";
import { qlooFromEnv } from "@/lib/qloo/client";
import { crossSiteResponse, sameOrigin } from "@/lib/publisher/owner";

// A live run is throttled to the Qloo key's rate (the hero preset makes ~76 calls at 4/s with the scripted model; `pnpm demo` prints the count) plus up to four model calls.
export const maxDuration = 120;

const NDJSON = { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store" };

/** What a visitor reads when a run fails: a sentence, never a bare "Qloo 503 on /search". */
export function runErrorMessage(err: unknown): string {
  if (err instanceof HttpError && err.service === "Qloo") {
    const what = err.status === 401 || err.status === 403 ? "refused this deployment's key" : "couldn't answer";
    return `Live Qloo ${what} (HTTP ${String(err.status)} on ${err.path}), so this brief can't run right now. The presets still load.`;
  }
  const text = err instanceof Error ? err.message : "The run failed.";
  return /[.!?]$/.test(text) ? text : `${text}.`;
}

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
          send({ type: "error", message: runErrorMessage(err) });
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
  if (hasLoneSurrogate(json)) return Response.json({ error: MALFORMED_TEXT }, { status: 400 });
  const request = resolveRunRequest(json);
  if (!request.ok) return Response.json({ error: request.error }, { status: request.status });

  const cached = await cachedRun(request.brief);
  // "Re-run live" means live: a cached result for the preset doesn't answer it.
  const lookup = request.fresh ? { ...cached, result: undefined } : cached;
  const recording = request.presetId ? recordedRuns().get(request.presetId) : undefined;
  if (!lookup.result && recording && !request.fresh) {
    return ndjson((send) => Promise.resolve(replay(recording, { from: "recording" }, send)), { "X-Run-Cache": "recording" });
  }
  // Single flight per brief on this instance: the first cold request is admitted (budget, limits) and starts the run;
  // concurrent ones wait for that and join it, spending nothing, or share its refusal.
  let refusal: Extract<GuardResult, { ok: false }> | undefined;
  let settle: ((r: typeof refusal) => void) | undefined;
  // A fresh "Re-run live" draws on other shares than a plain preset click, so it never shares that click's admission.
  const flight = request.fresh ? `${lookup.key}|fresh` : lookup.key;
  if (!lookup.result && !costsMoney(lookup.deps) && !request.presetId) {
    // Unmetered (no key): nothing is spent, but each run still costs CPU and a stored result.
    const tooMany = await unmeteredGuard(req);
    if (tooMany) return tooMany;
  }
  if (!lookup.result && !isInFlight(lookup.key) && costsMoney(lookup.deps)) {
    for (;;) {
      const pending = admissions.get(flight);
      if (!pending) {
        admissions.set(flight, new Promise((resolve) => (settle = resolve)));
        try {
          refusal = await admitNewRun(req, request, lookup);
        } catch (err) {
          // Never leave waiters hanging: they get a refusal, this request the error.
          admissions.delete(flight);
          settle?.(qlooRefusal("store"));
          throw err;
        }
        // Released below, once this request's run is in flight (or refused), so the waiters see it.
        break;
      }
      const shared = await pending;
      // A leader refused for its own network (its share or per-IP limit: a 429) says nothing about the waiters:
      // the first of them to get here leads a new admission, and the rest wait for that one in turn.
      if (shared?.status !== 429) {
        refusal = shared;
        break;
      }
      if (isInFlight(lookup.key)) break;
    }
  }
  const done = () => {
    if (!settle) return;
    admissions.delete(flight);
    settle(refusal);
  };
  if (refusal) {
    done();
    // A refused run shows the preset's recording, else this brief's last finished run, labelled with why.
    const reason = `a new live run was refused (${refusal.message})`;
    if (recording) return ndjson((send) => Promise.resolve(replay(recording, { from: "recording", reason }, send)), { "X-Run-Cache": "recording" });
    const last = await lastRun(lookup);
    if (last) {
      const served = servedAs(last, "cache", reason, lookup.deps);
      return ndjson((send) => Promise.resolve(replay(last, served, send)), { "X-Run-Cache": served.from });
    }
    // A preset always answers, on the labelled offline simulator if need be; a custom brief gets the refusal.
    if (!request.presetId) return guardResponse(refusal);
    const preset = { brief: request.brief, lookup };
    return ndjson(async (send) => (await presetFallback(preset, reason, send)).result, { "X-Run-Cache": "simulated" });
  }
  const owner = isOwnerRequest(req.headers);
  // Only the request that was admitted (the leader of a new paid run) has anything to give back.
  const admitted = settle !== undefined && !refusal;
  const work = async (send: (e: RunEvent) => void) => {
    const out = await getOrRun(lookup, send, recording)
      .catch(async (err: unknown) => {
        // No audience name resolved: with the scripted model the run spent nothing, so it doesn't count toward the limits.
        // A live model's baseline draft starts alongside the seed lookup and is already paid for, so that run still counts.
        if (admitted && err instanceof NoSeedError && lookup.deps.llm.scripted) await refundAdmission(req, { perIp: !request.presetId || request.fresh });
        // A preset is the first thing a visitor sees: if live Qloo fails outright and nothing is recorded, show its last
        // finished run, else the same preset on the labelled offline simulator (never mixed with live data), saying why.
        if (!request.presetId || recording) throw err;
        return presetFallback({ brief: request.brief, lookup }, `the live run failed (${err instanceof Error ? err.message : String(err)})`, send);
      })
      .finally(() => lookup.deps.qloo.release());
    // The owner was served this run from their own brief, so it may ship to real channels.
    if (owner) await markOwnerRun(out.result.id, lookup.deps.cache);
    return out;
  };
  const res = ndjson(work, { "X-Run-Cache": lookup.result ? "hit" : "miss" });
  // ndjson starts the work synchronously, so the run is in flight now: waiters join it.
  done();
  return res;
}

/**
 * A preset is the first thing a visitor sees, so when no new live run can answer it (refused or failed) and
 * nothing is recorded: its last finished run, else the same preset on the labelled offline simulator (every
 * call simulated, never mixed with recorded or live data), saying why. The simulated run is kept by id for a
 * day, so its permalink opens.
 */
async function presetFallback(preset: { brief: Brief; lookup: Lookup }, reason: string, send: (e: RunEvent) => void): Promise<{ result: RunResult; served: Served }> {
  const last = await lastRun(preset.lookup);
  if (last) {
    const served = servedAs(last, "cache", reason, preset.lookup.deps);
    return { result: replay(last, served, send), served };
  }
  const offline = await runTastemaker(preset.brief, { qloo: qlooFromEnv({ mode: "replay", fixtures: {} }), llm: new DeterministicLLM() });
  // Also this brief's last run for a while, so a burst of refused clicks replays it instead of each simulating anew.
  await keepFallbackRun(offline, preset.lookup.key, preset.lookup.deps.cache);
  const served: Served = { from: "simulated", reason };
  return { result: replay(offline, served, send), served };
}

/** Admissions in progress, by brief key: concurrent cold requests for one brief wait for the first one's outcome. */
const admissions = new Map<string, Promise<Extract<GuardResult, { ok: false }> | undefined>>();

/**
 * Admits a new paid run, or says why not. Its Qloo calls are reserved first
 * (each caller, or each cold preset, has its own daily share), and only a run
 * that got its budget counts toward the rate limits and the daily run cap, so
 * refused requests can't use up the cap for everyone.
 */
async function admitNewRun(req: Request, request: Extract<ResolvedRequest, { ok: true }>, lookup: Lookup): Promise<Extract<GuardResult, { ok: false }> | undefined> {
  if (!(await lookup.deps.qloo.reserve(loadConfig().QLOO_RUN_ESTIMATE, qlooBudget(request, clientIp(req.headers))))) return qlooRefusal(lookup.deps.qloo.refusedBy);
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
  // A run made on the simulator while this deployment has live Qloo was a fallback: its permalink says so.
  const served = result ? servedAs(result, "cache", "live Qloo was unavailable when this run was made", { qloo: qlooFromEnv() }) : undefined;
  return result ? Response.json({ result, ...(served?.from === "simulated" ? { served } : {}) }, { headers: { "Cache-Control": "public, max-age=300" } }) : Response.json({ error: "This run has expired or never existed." }, { status: 404 });
}
