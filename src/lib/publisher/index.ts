/**
 * "Ship": hand the verified campaign pack to a publisher.
 *
 * - SandboxPublisher (default, used on the public demo): validates the pack,
 *   builds the schedule and returns receipts clearly labeled as sandbox.
 *   Nothing is posted anywhere.
 * - SigmoraPublisher: calls Sigmora's narrow HTTPS /v1 interface with a bearer
 *   token from env. The token never reaches the model or the browser. Enabled
 *   only when SIGMORA_API_URL and SIGMORA_API_TOKEN are set and
 *   SIGMORA_PUBLISH_MODE=live.
 */
import { z } from "zod";

export const ShipRequest = z.object({
  runId: z.string().max(40),
  subject: z.string().max(80),
  posts: z
    .array(
      z.object({
        platform: z.string().max(30),
        text: z.string().max(600),
      }),
    )
    .min(1)
    .max(8),
  /** ISO date the first post goes out; defaults to tomorrow. */
  startDate: z.string().datetime().optional(),
  /** Picks that passed the Qloo critic, carried along as campaign metadata. */
  verifiedPicks: z.array(z.string().max(100)).max(20).default([]),
});
export type ShipRequest = z.infer<typeof ShipRequest>;

export interface ShipReceipt {
  publisher: "sandbox" | "sigmora";
  campaignId: string;
  posts: { platform: string; scheduledFor: string; status: "scheduled" | "sandbox"; externalId?: string }[];
  note: string;
}

export interface PublisherProvider {
  id: "sandbox" | "sigmora";
  ship(req: ShipRequest, now?: Date): Promise<ShipReceipt>;
}

/** One post a day, at 17:00 UTC, starting the day after `start`. */
export function schedule(req: ShipRequest, now = new Date()): { platform: string; scheduledFor: string }[] {
  const start = req.startDate ? new Date(req.startDate) : new Date(now.getTime() + 24 * 3600 * 1000);
  return req.posts.map((p, i) => {
    const d = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate() + i, 17, 0, 0));
    return { platform: p.platform, scheduledFor: d.toISOString() };
  });
}

export class SandboxPublisher implements PublisherProvider {
  id = "sandbox" as const;
  async ship(req: ShipRequest, now = new Date()): Promise<ShipReceipt> {
    return {
      publisher: "sandbox",
      campaignId: `sandbox-${req.runId}`,
      posts: schedule(req, now).map((s) => ({ ...s, status: "sandbox" })),
      note: "Sandbox publisher: the schedule is real, nothing was posted. Connect Sigmora to publish to real channels.",
    };
  }
}

export class SigmoraPublisher implements PublisherProvider {
  id = "sigmora" as const;
  constructor(
    private readonly baseUrl: string,
    private readonly token: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async ship(req: ShipRequest, now = new Date()): Promise<ShipReceipt> {
    const slots = schedule(req, now);
    const res = await this.fetchImpl(`${this.baseUrl.replace(/\/$/, "")}/v1/campaigns`, {
      method: "POST",
      headers: { authorization: `Bearer ${this.token}`, "content-type": "application/json" },
      body: JSON.stringify({
        source: "tastemaker",
        name: `${req.subject} — Tastemaker ${req.runId}`,
        metadata: { tastemakerRunId: req.runId, verifiedPicks: req.verifiedPicks },
        posts: req.posts.map((p, i) => ({ platform: p.platform, text: p.text, scheduledFor: slots[i].scheduledFor })),
      }),
    });
    if (!res.ok) throw new Error(`Sigmora /v1 returned ${res.status}`);
    const body = (await res.json()) as { id?: string; posts?: { id?: string }[] };
    return {
      publisher: "sigmora",
      campaignId: body.id ?? "unknown",
      posts: slots.map((s, i) => ({ ...s, status: "scheduled", externalId: body.posts?.[i]?.id })),
      note: "Scheduled through Sigmora.",
    };
  }
}

export function publisherFromEnv(env: Record<string, string | undefined> = process.env): PublisherProvider {
  if (env.SIGMORA_PUBLISH_MODE === "live" && env.SIGMORA_API_URL && env.SIGMORA_API_TOKEN) {
    return new SigmoraPublisher(env.SIGMORA_API_URL, env.SIGMORA_API_TOKEN);
  }
  return new SandboxPublisher();
}
