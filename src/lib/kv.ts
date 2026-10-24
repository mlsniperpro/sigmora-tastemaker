/**
 * Minimal Redis-over-REST client (Upstash / Vercel KV wire format), shared by
 * the response cache and the rate-limit/budget counters.
 */
import { z } from "zod";
import { loadConfig } from "./config";
import { ensureOk, fetchWithTimeout, joinUrl } from "./net";

const Reply = z.object({ result: z.unknown() });
const PipelineReply = z.array(Reply);
type Command = (string | number)[];

export class KvRest {
  constructor(
    private readonly url: string,
    private readonly token: string,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly timeoutMs = 2000,
  ) {}

  private async post(path: string, body: unknown): Promise<unknown> {
    const url = joinUrl(this.url, path);
    const res = await fetchWithTimeout(
      this.fetchImpl,
      "KV",
      url,
      { method: "POST", headers: { Authorization: `Bearer ${this.token}`, "Content-Type": "application/json" }, body: JSON.stringify(body), cache: "no-store" },
      this.timeoutMs,
    );
    await ensureOk(res, "KV", url);
    return res.json();
  }

  async cmd(args: Command): Promise<unknown> {
    return Reply.parse(await this.post("/", args)).result;
  }

  async pipeline(cmds: Command[]): Promise<unknown[]> {
    return PipelineReply.parse(await this.post("/pipeline", cmds)).map((r) => r.result);
  }
}

/** The configured KV, or undefined when KV_REST_API_URL / KV_REST_API_TOKEN aren't set. */
export function kvFromEnv(): KvRest | undefined {
  const env = loadConfig();
  return env.KV_REST_API_URL && env.KV_REST_API_TOKEN ? new KvRest(env.KV_REST_API_URL, env.KV_REST_API_TOKEN) : undefined;
}
