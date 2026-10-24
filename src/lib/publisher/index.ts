/**
 * "Ship": hand a verified campaign pack to a publisher.
 *
 * The server only ships plans it produced: the request names a run id and the
 * captions come from that cached run, never from the client.
 *
 * - SandboxPublisher (default, used on the public demo): builds the schedule
 *   and returns receipts labeled as sandbox. Nothing is posted.
 * - SigmoraPublisher: Sigmora's HTTPS /v1 interface with a bearer token from
 *   env (never seen by the model or the browser), an Idempotency-Key per run
 *   so retries can't double-post, a timeout, and bounded retries.
 */
import { z } from "zod";
import { loadConfig } from "../config";
import { DEFAULT_RETRY, ensureOk, fetchWithTimeout, joinUrl, withRetry, type RetryPolicy } from "../net";

export const ShipRequest = z.object({
  runId: z.string().regex(/^[a-z0-9]{1,40}$/),
  /** ISO date the first post goes out; defaults to tomorrow. */
  startDate: z.iso.datetime().optional(),
});
export type ShipRequest = z.infer<typeof ShipRequest>;

export interface ShipPlan {
  runId: string;
  subject: string;
  posts: { platform: string; text: string }[];
  verifiedPicks: string[];
  startDate?: string;
}

export interface ShipReceipt {
  publisher: "sandbox" | "sigmora";
  campaignId: string;
  posts: { platform: string; scheduledFor: string; status: "scheduled" | "sandbox"; externalId?: string }[];
  note: string;
}

export interface PublisherProvider {
  id: "sandbox" | "sigmora";
  ship(plan: ShipPlan, now?: Date): Promise<ShipReceipt>;
}

/** One post a day at 17:00 UTC, starting the day after `start` (or after now). */
export function schedule(plan: Pick<ShipPlan, "posts" | "startDate">, now = new Date()): { platform: string; scheduledFor: string }[] {
  const start = plan.startDate ? new Date(plan.startDate) : new Date(now.getTime() + 24 * 3600 * 1000);
  return plan.posts.map((p, i) => ({
    platform: p.platform,
    scheduledFor: new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate() + i, 17, 0, 0)).toISOString(),
  }));
}

export class SandboxPublisher implements PublisherProvider {
  id = "sandbox" as const;
  async ship(plan: ShipPlan, now = new Date()): Promise<ShipReceipt> {
    return {
      publisher: "sandbox",
      campaignId: `sandbox-${plan.runId}`,
      posts: schedule(plan, now).map((s) => ({ ...s, status: "sandbox" })),
      note: "Sandbox publisher: the schedule is real, nothing was posted. Connect Sigmora to publish to real channels.",
    };
  }
}

const SigmoraReply = z.object({ id: z.string().min(1), posts: z.array(z.object({ id: z.string().optional() })).optional() });

export class SigmoraPublisher implements PublisherProvider {
  id = "sigmora" as const;
  constructor(
    private readonly baseUrl: string,
    private readonly token: string,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly retry: RetryPolicy = DEFAULT_RETRY,
    private readonly timeoutMs = 15000,
  ) {}

  async ship(plan: ShipPlan, now = new Date()): Promise<ShipReceipt> {
    const slots = schedule(plan, now);
    const url = joinUrl(this.baseUrl, "/v1/campaigns");
    const body = JSON.stringify({
      source: "tastemaker",
      name: `${plan.subject} — Tastemaker ${plan.runId}`,
      metadata: { tastemakerRunId: plan.runId, verifiedPicks: plan.verifiedPicks },
      posts: plan.posts.map((p, i) => ({ platform: p.platform, text: p.text, scheduledFor: slots[i].scheduledFor })),
    });
    const reply = await withRetry(async () => {
      const res = await fetchWithTimeout(
        this.fetchImpl,
        "Sigmora",
        url,
        {
          method: "POST",
          headers: { authorization: `Bearer ${this.token}`, "content-type": "application/json", "idempotency-key": `tastemaker-${plan.runId}` },
          body,
        },
        this.timeoutMs,
      );
      await ensureOk(res, "Sigmora", url);
      return SigmoraReply.parse(await res.json());
    }, this.retry);
    return {
      publisher: "sigmora",
      campaignId: reply.id,
      posts: slots.map((s, i) => ({ ...s, status: "scheduled", externalId: reply.posts?.[i]?.id })),
      note: "Scheduled through Sigmora.",
    };
  }
}

export function publisherFromEnv(raw: Record<string, string | undefined> = process.env): PublisherProvider {
  const env = loadConfig(raw);
  if (env.SIGMORA_PUBLISH_MODE === "live" && env.SIGMORA_API_URL && env.SIGMORA_API_TOKEN) {
    return new SigmoraPublisher(env.SIGMORA_API_URL, env.SIGMORA_API_TOKEN);
  }
  return new SandboxPublisher();
}
