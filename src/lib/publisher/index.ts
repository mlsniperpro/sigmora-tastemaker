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
 *
 * Only the owner reaches SigmoraPublisher (see publisherFor); every other
 * caller, in any mode, gets the sandbox.
 *
 * Measuring (for the re-query loop) reads a campaign's post performance
 * back, with the Tastemaker run it was shipped from. The sandbox posted
 * nothing, so it has nothing to measure and says so.
 */
import { z } from "zod";
import { ConfigError, loadConfig } from "../config";
import { CampaignId } from "../ids";
import { ownerCredentialOf, ownerCredentialValid } from "./owner";
import { DEFAULT_RETRY, ensureOk, fetchWithTimeout, joinUrl, withRetry, type RetryPolicy } from "../net";

export const ShipRequest = z.object({
  runId: z.string().regex(/^[a-z0-9]{1,40}$/),
  /** ISO date the first post goes out; defaults to tomorrow. */
  startDate: z.iso.datetime().optional(),
  /** Ship even though some picks still failed the critic (the caller has shown them to the user). */
  acceptFlagged: z.boolean().optional(),
});
export type ShipRequest = z.infer<typeof ShipRequest>;

export interface ShipPlan {
  runId: string;
  subject: string;
  posts: { platform: string; text: string }[];
  verifiedPicks: string[];
  /** The rest of the pack, for the production step: positioning, hooks, the 30-second script, the music and visual brief. */
  assets: { positioning: string; hooks: string[]; script: string; musicBrief: string };
  /** Picks that still failed the critic, shipped only because the user accepted them. */
  flaggedPicks: string[];
  startDate?: string;
}

export interface ShipReceipt {
  publisher: "sandbox" | "sigmora";
  campaignId: string;
  posts: { platform: string; scheduledFor: string; status: "scheduled" | "sandbox"; externalId?: string }[];
  note: string;
}

export const MeasureRequest = z.object({ campaignId: CampaignId });

export interface CampaignMetrics {
  campaignId: string;
  /** The Tastemaker run the campaign was shipped from. */
  runId: string;
  posts: { platform: string; text: string; impressions: number; engagements: number }[];
}

/** Measuring isn't possible for this campaign (sandbox, or not shipped from this run). */
export class MetricsUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MetricsUnavailableError";
  }
}

export interface PublisherProvider {
  id: "sandbox" | "sigmora";
  ship(plan: ShipPlan, now?: Date): Promise<ShipReceipt>;
  metrics(campaignId: string): Promise<CampaignMetrics>;
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
  ship(plan: ShipPlan, now = new Date()): Promise<ShipReceipt> {
    return Promise.resolve({
      publisher: "sandbox",
      campaignId: `sandbox-${plan.runId}`,
      posts: schedule(plan, now).map((s) => ({ ...s, status: "sandbox" })),
      note: "Sandbox publisher: the schedule is real, nothing was posted. Connect Sigmora to publish to real channels.",
    });
  }

  metrics(): Promise<CampaignMetrics> {
    return Promise.reject(new MetricsUnavailableError("The sandbox posted nothing, so there is nothing to measure. Connect Sigmora to measure real posts."));
  }
}

const SigmoraReply = z.object({ id: z.string().min(1), posts: z.array(z.object({ id: z.string().optional() })).optional() });
const count = z.number().int().nonnegative();
const SigmoraMetrics = z.object({
  id: z.string().min(1),
  metadata: z.object({ tastemakerRunId: z.string().optional() }).loose().optional(),
  posts: z.array(z.object({ platform: z.string().min(1), text: z.string().max(5000), impressions: count, engagements: count })).max(50),
});

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
    const reply = await this.request("/v1/campaigns", SigmoraReply, {
      method: "POST",
      headers: { "content-type": "application/json", "idempotency-key": `tastemaker-${plan.runId}` },
      body: JSON.stringify({
        source: "tastemaker",
        name: `${plan.subject} — Tastemaker ${plan.runId}`,
        metadata: { tastemakerRunId: plan.runId, verifiedPicks: plan.verifiedPicks, flaggedPicks: plan.flaggedPicks },
        assets: plan.assets,
        posts: plan.posts.map((p, i) => ({ platform: p.platform, text: p.text, scheduledFor: slots[i]?.scheduledFor })),
      }),
    });
    return {
      publisher: "sigmora",
      campaignId: reply.id,
      posts: slots.map((s, i) => ({ ...s, status: "scheduled", externalId: reply.posts?.[i]?.id })),
      note: "Scheduled through Sigmora.",
    };
  }

  async metrics(campaignId: string): Promise<CampaignMetrics> {
    const reply = await this.request(`/v1/campaigns/${encodeURIComponent(campaignId)}/metrics`, SigmoraMetrics, { method: "GET", headers: { accept: "application/json" } });
    const runId = reply.metadata?.tastemakerRunId;
    if (!runId) throw new MetricsUnavailableError("That campaign wasn't shipped from Tastemaker.");
    return { campaignId: reply.id, runId, posts: reply.posts };
  }

  /** One authenticated /v1 call: timeout, bounded retries, validated reply. */
  private request<S extends z.ZodType>(path: string, schema: S, init: { method: "GET" | "POST"; headers: Record<string, string>; body?: string }): Promise<z.infer<S>> {
    const url = joinUrl(this.baseUrl, path);
    return withRetry(async () => {
      const res = await fetchWithTimeout(this.fetchImpl, "Sigmora", url, { ...init, headers: { ...init.headers, authorization: `Bearer ${this.token}` } }, this.timeoutMs);
      await ensureOk(res, "Sigmora", url);
      return schema.parse(await res.json());
    }, this.retry);
  }
}

/** The owner presented the wrong key: refused outright rather than quietly downgraded to the sandbox. */
export class OwnerKeyError extends Error {
  constructor() {
    super("That owner key isn't valid.");
    this.name = "OwnerKeyError";
  }
}

export { OWNER_COOKIE, OWNER_HEADER } from "./owner";

/**
 * The publisher for this request. Real channels need live mode on the server
 * AND the owner's key on the request, so the public demo (no key) always gets
 * the labeled sandbox and can never post as the brand. Live mode with its
 * settings missing is a configuration error for the owner (a 500), and the
 * sandbox for everyone else. The
 * owner is the header key or an unexpired session token from /api/owner.
 */
export function publisherFor(headers: Headers, raw: Record<string, string | undefined> = process.env, now = Date.now()): PublisherProvider {
  const env = loadConfig(raw);
  if (env.SIGMORA_PUBLISH_MODE !== "live") return new SandboxPublisher();
  const presented = ownerCredentialOf(headers);
  if (!env.SIGMORA_API_URL || !env.SIGMORA_API_TOKEN || !env.SIGMORA_OWNER_KEY) {
    const problem = "SIGMORA_PUBLISH_MODE=live needs SIGMORA_API_URL, SIGMORA_API_TOKEN and SIGMORA_OWNER_KEY";
    // Only the owner is told: visitors get the sandbox they'd get anyway, so one bad env change can't break Ship for judges.
    if (presented !== undefined) throw new ConfigError(problem);
    console.error(`[publisher] ${problem}; serving the sandbox`);
    return new SandboxPublisher();
  }
  if (presented === undefined) return new SandboxPublisher();
  if (!ownerCredentialValid(presented, env.SIGMORA_OWNER_KEY, now)) throw new OwnerKeyError();
  return new SigmoraPublisher(env.SIGMORA_API_URL, env.SIGMORA_API_TOKEN);
}

/** True when the request is the signed-in owner on a correctly configured live deployment. */
export function isOwnerRequest(headers: Headers, raw: Record<string, string | undefined> = process.env): boolean {
  try {
    return publisherFor(headers, raw).id === "sigmora";
  } catch {
    return false;
  }
}

/** publisherFor as a route needs it: the publisher, or the response that refuses the request. */
export function publisherForRequest(req: Request): PublisherProvider | Response {
  try {
    return publisherFor(req.headers);
  } catch (err) {
    if (err instanceof OwnerKeyError) return Response.json({ error: err.message }, { status: 403 });
    console.error(`[publisher] ${(err as Error).message}`);
    return Response.json({ error: "Publishing is misconfigured on this deployment." }, { status: 500 });
  }
}
