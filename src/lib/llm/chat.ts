/**
 * One chat completion over plain HTTPS, in either of the two wire formats
 * that cover most vendors (OpenAI-compatible chat completions, Anthropic
 * Messages), with a timeout and bounded retries. Shared by the campaign model
 * and the benchmark judge; plus a record/replay wrapper for fixtures.
 */
import { createHash } from "node:crypto";
import { z } from "zod";
import { HttpError, ensureOk, fetchWithTimeout, joinUrl, withRetry, type RetryPolicy } from "../net";

export type WireFormat = "openai" | "anthropic";

export interface ChatClient {
  /** "<format>:<model>", or "replay:<model>" style ids for wrappers. */
  readonly id: string;
  readonly model: string;
  complete(system: string, user: string): Promise<string>;
}

export interface HttpChatOptions {
  format: WireFormat;
  model: string;
  apiKey: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  retry?: RetryPolicy;
  /** Ask OpenAI-compatible hosts for a JSON object (dropped if the host rejects it). */
  json?: boolean;
  maxTokens?: number;
  /** Anthropic `output_config.effort`; omitted when unset. */
  effort?: "low" | "medium" | "high" | "xhigh" | "max";
}

const SERVICE = "LLM";
/** One retry: callers make several model calls and must finish inside a request's time limit. */
export const LLM_RETRY: RetryPolicy = { retries: 1, baseMs: 500, maxMs: 3000 };

const OpenAIReply = z.object({ choices: z.array(z.object({ message: z.object({ content: z.string().nullable().optional() }) })).min(1) });
const AnthropicReply = z.object({ content: z.array(z.object({ type: z.string(), text: z.string().optional() })) });

export class HttpChat implements ChatClient {
  readonly id: string;
  readonly model: string;
  private readonly fetchImpl: typeof fetch;
  private jsonMode: boolean;

  constructor(private readonly o: HttpChatOptions) {
    this.id = `${o.format}:${o.model}`;
    this.model = o.model;
    this.fetchImpl = o.fetchImpl ?? fetch;
    this.jsonMode = o.json ?? true;
  }

  private post(url: string, headers: Record<string, string>, body: unknown) {
    return fetchWithTimeout(
      this.fetchImpl,
      SERVICE,
      url,
      // No redirects: the API key header must never follow a reply to another origin.
      { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body), redirect: "error" },
      this.o.timeoutMs ?? 25000,
    );
  }

  /** A 200 that isn't the provider's JSON (a gateway page, a changed API) is a service error, so its text never reaches a visitor. */
  private async reply<T>(res: Response, url: string, schema: { safeParse(v: unknown): { success: true; data: T } | { success: false } }): Promise<T> {
    const parsed = schema.safeParse(await res.json().catch(() => undefined));
    if (!parsed.success) throw new HttpError(SERVICE, res.status, new URL(url).pathname);
    return parsed.data;
  }

  private async anthropic(system: string, user: string): Promise<string> {
    const url = joinUrl(this.o.baseUrl ?? "https://api.anthropic.com", "/v1/messages");
    const res = await this.post(url, { "x-api-key": this.o.apiKey, "anthropic-version": "2023-06-01" }, {
      model: this.o.model,
      // Current Claude models think by default and thinking counts against max_tokens, so leave room past the answer.
      max_tokens: this.o.maxTokens ?? 8000,
      ...(this.o.effort ? { output_config: { effort: this.o.effort } } : {}),
      system,
      messages: [{ role: "user", content: user }],
    });
    await ensureOk(res, SERVICE, url);
    return (await this.reply(res, url, AnthropicReply)).content.map((c) => c.text ?? "").join("");
  }

  private async openai(system: string, user: string): Promise<string> {
    const url = joinUrl(this.o.baseUrl ?? "https://api.openai.com/v1", "/chat/completions");
    const body = {
      model: this.o.model,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      ...(this.jsonMode ? { response_format: { type: "json_object" } } : {}),
    };
    const res = await this.post(url, { authorization: `Bearer ${this.o.apiKey}` }, body);
    if (res.status === 400 && this.jsonMode) {
      // Some OpenAI-compatible hosts reject response_format; the prompt already demands JSON.
      // Only that 400 switches JSON mode off; any other 400 is a real error.
      const detail = await res.text().catch(() => "");
      if (/response_format|json_object|json mode/i.test(detail)) {
        this.jsonMode = false;
        return this.openai(system, user);
      }
      throw new HttpError(SERVICE, 400, new URL(url).pathname);
    }
    await ensureOk(res, SERVICE, url);
    return (await this.reply(res, url, OpenAIReply)).choices[0]?.message.content ?? "";
  }

  /** Retried with backoff on 429 / 5xx / timeouts (a completion has no side effects). */
  complete(system: string, user: string): Promise<string> {
    return withRetry(() => (this.o.format === "anthropic" ? this.anthropic(system, user) : this.openai(system, user)), this.o.retry ?? LLM_RETRY);
  }
}

export class NoRecordingError extends Error {
  constructor(key: string) {
    super(`No recorded completion for ${key.slice(0, 12)}… and no live model configured`);
    this.name = "NoRecordingError";
  }
}

/** Stable fixture key for one completion: model + exact prompts. */
export function completionKey(model: string, system: string, user: string): string {
  return createHash("sha256").update(JSON.stringify([model, system, user])).digest("hex");
}

/**
 * Replay-first wrapper: answers from recorded completions when it has one,
 * otherwise calls the live client (if any) and records the reply, so a later
 * run of the same prompts needs no key and gives the same answers.
 */
export class ReplayChat implements ChatClient {
  readonly id: string;
  /** Completions answered from fixtures / from the live client in this process. */
  replayed = 0;
  live = 0;

  constructor(
    readonly model: string,
    private readonly fixtures: Readonly<Record<string, string>>,
    private readonly inner?: ChatClient,
    private readonly recorder?: Record<string, string>,
  ) {
    this.id = inner ? `replay+${inner.id}` : `replay:${model}`;
  }

  async complete(system: string, user: string): Promise<string> {
    const key = completionKey(this.model, system, user);
    const hit = this.fixtures[key];
    if (hit !== undefined) {
      this.replayed++;
      return hit;
    }
    if (!this.inner) throw new NoRecordingError(key);
    const reply = await this.inner.complete(system, user);
    this.live++;
    if (this.recorder) this.recorder[key] = reply;
    return reply;
  }
}
