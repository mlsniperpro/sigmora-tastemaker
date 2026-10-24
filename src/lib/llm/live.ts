/**
 * Live LLM provider over plain HTTPS. Two wire formats cover most vendors:
 * OpenAI-compatible chat completions (OpenAI, OpenRouter, Groq, Together,
 * vLLM, Ollama, …) and the Anthropic Messages API. Provider, model, base URL
 * and key all come from env, so no vendor is pinned.
 */
import { z } from "zod";
import { ROLE_SPEC, type Role } from "../agent/brief";
import { HttpError, ensureOk, fetchWithTimeout, joinUrl, withRetry, type RetryPolicy } from "../net";
import { coerceDraft, extractJson, LLMOutputError } from "./coerce";
import type { Draft, DraftInput, LLMProvider, Replacement } from "./types";

const SERVICE = "LLM";
/** One retry: a run makes up to four model calls and must finish inside the request's time limit. */
const LLM_RETRY: RetryPolicy = { retries: 1, baseMs: 500, maxMs: 3000 };

export type WireFormat = "openai" | "anthropic";

export interface LiveLLMOptions {
  format: WireFormat;
  model: string;
  apiKey: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  retry?: RetryPolicy;
}

const SYSTEM = `You are a senior marketing strategist planning a launch campaign.
Return ONLY a JSON object, no prose, matching this TypeScript type:
{ "positioning": string, "hooks": string[3], "script": string (30-second beat sheet),
  "captions": {"platform": "TikTok"|"Instagram Reels"|"YouTube Shorts"|"X", "text": string}[4],
  "musicBrief": string,
  "picks": {"name": string, "type": "artist"|"brand"|"tv_show"|"movie"|"podcast"|"place"|"person"|"locality",
             "role": "collab"|"sponsor"|"reference"|"podcast"|"venue"|"presenter"|"city", "rationale": string}[] }
Rules: list EVERY real-world artist, brand, show, film, podcast, venue, person and city you mention in "picks".
Text fields may only name entities that appear in "picks". Use real, specific names.`;

function roleSpec(input: DraftInput) {
  return (Object.keys(ROLE_SPEC) as Role[])
    .filter((r) => !(r === "city" && input.brief.targetCity))
    .map((r) => `${ROLE_SPEC[r].count} × ${r} (type: ${ROLE_SPEC[r].types.join(" or ")})`)
    .join("; ");
}

export function buildDraftPrompt(input: DraftInput): string {
  const b = input.brief;
  const lines = [
    `Who: ${b.subject}. Launching: ${b.product}.`,
    `Goal: ${b.goal}`,
    b.vibe ? `Vibe: ${b.vibe}` : "",
    `Audience: ages ${b.ages.join(", ")}${b.gender ? `, ${b.gender}-skewed` : ""}; they already love ${b.seeds.join(", ")}.`,
    b.targetCity ? `Market: ${b.targetCity}.` : b.candidateCities.length ? `Pick the launch city from: ${b.candidateCities.join(", ")}.` : "",
    `Picks required: ${roleSpec(input)}.`,
  ];
  const g = input.grounding;
  if (g) {
    lines.push(
      "",
      "Audience data from Qloo (aggregate taste affinity; prefer these over your own guesses):",
      `- Taste descriptors that over-index: ${g.tags.join(", ")}`,
      `- Age buckets that over-index: ${g.overIndexAges.join(", ")}`,
      ...Object.entries(g.candidates).map(
        ([role, cs]) => `- ${role} candidates (best first): ${cs!.map((c) => `${c.name} (${c.affinity.toFixed(2)})`).join(", ")}`,
      ),
      g.positioningTags?.length ? `- Where this audience differs from the comparable's: ${g.positioningTags.join(", ")}` : "",
    );
  }
  return lines.filter(Boolean).join("\n");
}

const OpenAIReply = z.object({ choices: z.array(z.object({ message: z.object({ content: z.string().nullable().optional() }) })).min(1) });
const AnthropicReply = z.object({ content: z.array(z.object({ type: z.string(), text: z.string().optional() })) });

export class LiveLLM implements LLMProvider {
  readonly id: string;
  readonly label: string;
  readonly scripted = false;
  private readonly fetchImpl: typeof fetch;
  private jsonMode = true;

  constructor(private readonly o: LiveLLMOptions) {
    this.id = `${o.format}:${o.model}`;
    this.label = o.model;
    this.fetchImpl = o.fetchImpl ?? fetch;
  }

  private post(url: string, headers: Record<string, string>, body: unknown) {
    return fetchWithTimeout(
      this.fetchImpl,
      SERVICE,
      url,
      { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) },
      this.o.timeoutMs ?? 25000,
    );
  }

  private async completeAnthropic(user: string): Promise<string> {
    const url = joinUrl(this.o.baseUrl ?? "https://api.anthropic.com", "/v1/messages");
    const res = await this.post(url, { "x-api-key": this.o.apiKey, "anthropic-version": "2023-06-01" }, {
      model: this.o.model,
      max_tokens: 2000,
      system: SYSTEM,
      messages: [{ role: "user", content: user }],
    });
    await ensureOk(res, SERVICE, url);
    return AnthropicReply.parse(await res.json()).content.map((c) => c.text ?? "").join("");
  }

  private async completeOpenAI(user: string): Promise<string> {
    const url = joinUrl(this.o.baseUrl ?? "https://api.openai.com/v1", "/chat/completions");
    const body = {
      model: this.o.model,
      messages: [
        { role: "system", content: SYSTEM },
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
        return this.completeOpenAI(user);
      }
      throw new HttpError(SERVICE, 400, new URL(url).pathname);
    }
    await ensureOk(res, SERVICE, url);
    return OpenAIReply.parse(await res.json()).choices[0].message.content ?? "";
  }

  /** One completion, retried with backoff on 429 / 5xx / timeouts (generation has no side effects). */
  private complete(user: string): Promise<string> {
    return withRetry(() => (this.o.format === "anthropic" ? this.completeAnthropic(user) : this.completeOpenAI(user)), this.o.retry ?? LLM_RETRY);
  }

  private async completeDraft(prompt: string): Promise<Draft> {
    try {
      return coerceDraft(extractJson(await this.complete(prompt)));
    } catch (err) {
      if (!(err instanceof LLMOutputError)) throw err;
      // One repair attempt for unusable output; transport errors were already retried.
      return coerceDraft(extractJson(await this.complete(`${prompt}\n\nYour previous answer was not usable (${err.message}). Return only the JSON object.`)));
    }
  }

  draft(input: DraftInput): Promise<Draft> {
    return this.completeDraft(buildDraftPrompt(input));
  }

  /** Polish the copy around picks the critic already swapped in (code owns the pick list). */
  revise(draft: Draft, replacements: Replacement[], input: DraftInput): Promise<Draft> {
    const prompt = [
      buildDraftPrompt(input),
      "",
      "Here is the plan. A taste check against Qloo already swapped some picks; the pick list is final:",
      JSON.stringify(draft),
      "",
      "Swaps made:",
      ...replacements.map((r) => `- "${r.from}" → "${r.to}" (${r.role}): ${r.reason}`),
      "",
      "Rewrite positioning, hooks, script, captions and musicBrief so they read naturally around the new picks. Keep \"picks\" exactly as given and never mention a replaced name.",
    ].join("\n");
    return this.completeDraft(prompt);
  }
}
