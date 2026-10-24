import { z } from "zod";
import { Brief } from "@/lib/agent/brief";
import { presetById } from "@/lib/agent/presets";
import { runTastemaker } from "@/lib/agent/run";
import type { RunEvent, RunResult } from "@/lib/agent/types";
import { hashId } from "@/lib/agent/util";
import { checkGuard, clientIp } from "@/lib/guard";
import { llmFromEnv } from "@/lib/llm";
import { defaultCache } from "@/lib/qloo/cache";
import { qlooFromEnv } from "@/lib/qloo/client";

export const maxDuration = 60;

const Body = z.union([z.object({ preset: z.string().max(40) }), z.object({ brief: Brief })]);

const RESULT_TTL = 60 * 60 * 24;

/**
 * POST /api/run → NDJSON stream of RunEvent lines: one "step" per trace step
 * as it completes, then one "result" (or "error").
 */
export async function POST(req: Request) {
  let body: z.infer<typeof Body>;
  try {
    body = Body.parse(await req.json());
  } catch (err) {
    const message = err instanceof z.ZodError ? err.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") : "Invalid JSON";
    return Response.json({ error: message }, { status: 400 });
  }
  const preset = "preset" in body ? presetById(body.preset) : undefined;
  if ("preset" in body && !preset) return Response.json({ error: "Unknown preset" }, { status: 404 });
  const brief = Brief.parse(preset ? preset.brief : (body as { brief: Brief }).brief);

  const qloo = qlooFromEnv();
  const llm = llmFromEnv();
  const cacheKey = `run:${hashId(JSON.stringify([brief, llm.id, qloo.primarySource]))}`;
  const cache = defaultCache();
  const cached = (await cache.get(cacheKey)) as RunResult | undefined;

  if (!cached) {
    const g = checkGuard(clientIp(req.headers));
    if (!g.ok && !preset) {
      return Response.json({ error: g.message }, { status: g.status, headers: { "Retry-After": String(g.retryAfter) } });
    }
  }

  const enc = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (e: RunEvent) => controller.enqueue(enc.encode(JSON.stringify(e) + "\n"));
      try {
        if (cached) {
          for (const step of cached.trace) send({ type: "step", step });
          send({ type: "result", result: cached });
        } else {
          const result = await runTastemaker(brief, { qloo, llm, emit: send });
          await cache.set(cacheKey, result, RESULT_TTL);
        }
      } catch (err) {
        send({ type: "error", message: err instanceof Error ? err.message : "Run failed" });
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, {
    headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store", "X-Run-Cache": cached ? "hit" : "miss" },
  });
}
