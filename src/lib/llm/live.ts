/**
 * Live LLM provider over plain HTTPS. Two wire formats cover most vendors:
 * OpenAI-compatible chat completions (OpenAI, OpenRouter, Groq, Together,
 * vLLM, Ollama, …) and the Anthropic Messages API. Provider, model, base URL
 * and key all come from env, so no vendor is pinned.
 */
import { ROLE_COUNTS, ROLE_TYPES, type Role } from "../agent/brief";
import { applyReplacements, Draft, type DraftInput, type LLMProvider, type Replacement } from "./types";

export type WireFormat = "openai" | "anthropic";

export interface LiveLLMOptions {
  format: WireFormat;
  model: string;
  apiKey: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
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
  return (Object.keys(ROLE_COUNTS) as Role[])
    .filter((r) => !(r === "city" && input.brief.targetCity))
    .map((r) => `${ROLE_COUNTS[r]} × ${r} (type: ${ROLE_TYPES[r].join(" or ")})`)
    .join("; ");
}

export function buildDraftPrompt(input: DraftInput): string {
  const b = input.brief;
  const lines = [
    `Who: ${b.subject}. Launching: ${b.product}.`,
    `Goal: ${b.goal}`,
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

function extractJson(text: string): unknown {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end < start) throw new Error("model returned no JSON object");
  return JSON.parse(text.slice(start, end + 1));
}

export class LiveLLM implements LLMProvider {
  readonly id: string;
  readonly label: string;
  readonly scripted = false;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly o: LiveLLMOptions) {
    this.id = `${o.format}:${o.model}`;
    this.label = o.model;
    this.fetchImpl = o.fetchImpl ?? fetch;
  }

  private async complete(user: string): Promise<string> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.o.timeoutMs ?? 45000);
    try {
      if (this.o.format === "anthropic") {
        const res = await this.fetchImpl(`${this.o.baseUrl ?? "https://api.anthropic.com"}/v1/messages`, {
          method: "POST",
          signal: ctrl.signal,
          headers: {
            "content-type": "application/json",
            "x-api-key": this.o.apiKey,
            "anthropic-version": "2023-06-01",
          },
          body: JSON.stringify({
            model: this.o.model,
            max_tokens: 2000,
            system: SYSTEM,
            messages: [{ role: "user", content: user }],
          }),
        });
        if (!res.ok) throw new Error(`LLM ${res.status}`);
        const body = (await res.json()) as { content?: { type: string; text?: string }[] };
        return (body.content ?? []).map((c) => c.text ?? "").join("");
      }
      const res = await this.fetchImpl(`${this.o.baseUrl ?? "https://api.openai.com/v1"}/chat/completions`, {
        method: "POST",
        signal: ctrl.signal,
        headers: { "content-type": "application/json", authorization: `Bearer ${this.o.apiKey}` },
        body: JSON.stringify({
          model: this.o.model,
          messages: [
            { role: "system", content: SYSTEM },
            { role: "user", content: user },
          ],
          response_format: { type: "json_object" },
        }),
      });
      if (!res.ok) throw new Error(`LLM ${res.status}`);
      const body = (await res.json()) as { choices?: { message?: { content?: string } }[] };
      return body.choices?.[0]?.message?.content ?? "";
    } finally {
      clearTimeout(timer);
    }
  }

  private async completeDraft(prompt: string): Promise<Draft> {
    let lastErr: unknown;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const text = await this.complete(attempt ? `${prompt}\n\nYour previous answer was not valid JSON for the schema. Return only the JSON object.` : prompt);
        return Draft.parse(extractJson(text));
      } catch (err) {
        lastErr = err;
      }
    }
    throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
  }

  draft(input: DraftInput): Promise<Draft> {
    return this.completeDraft(buildDraftPrompt(input));
  }

  async revise(draft: Draft, replacements: Replacement[], input: DraftInput): Promise<Draft> {
    const prompt = [
      buildDraftPrompt(input),
      "",
      "Here is your previous plan:",
      JSON.stringify(draft),
      "",
      "A taste check against Qloo rejected some picks. Rewrite the plan with these exact replacements, keeping everything else:",
      ...replacements.map((r) => `- replace "${r.from}" (${r.role}) with "${r.to}" — ${r.reason}`),
    ].join("\n");
    try {
      return await this.completeDraft(prompt);
    } catch {
      // A failed rewrite must never lose a verified replacement.
      return applyReplacements(draft, replacements);
    }
  }
}
