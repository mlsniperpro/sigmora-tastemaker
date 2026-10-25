/**
 * The live campaign model. The transport (src/lib/llm/chat.ts) speaks
 * OpenAI-compatible chat completions or Anthropic Messages; provider, model,
 * base URL and key all come from env, so no vendor is pinned.
 */
import { ROLE_SPEC, type Role } from "../agent/brief";
import type { ChatClient } from "./chat";
import { coerceDraft, extractJson, LLMOutputError } from "./coerce";
import { z } from "zod";
import type { Choice, Draft, DraftInput, LLMProvider, Replacement } from "./types";

const SYSTEM = `You are a senior marketing strategist planning a launch campaign.
Return ONLY a JSON object, no prose, matching this TypeScript type:
{ "positioning": string, "hooks": string[3], "script": string (30-second beat sheet),
  "captions": {"platform": "TikTok"|"Instagram Reels"|"YouTube Shorts"|"X", "text": string}[4],
  "musicBrief": string,
  "picks": {"name": string, "type": "artist"|"brand"|"tv_show"|"movie"|"podcast"|"place"|"person"|"locality",
             "role": "collab"|"sponsor"|"reference"|"podcast"|"venue"|"presenter"|"city", "rationale": string}[] }
Rules: list EVERY real-world artist, brand, show, film, podcast, venue, person and city you mention in "picks".
Text fields may only name entities that appear in "picks". Use real, specific names.
Never put scores, percentages or data sources in the copy: it is read by the audience, not by us.`;

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
        ([role, cs]) => `- ${role} candidates (best first): ${cs.map((c) => `${c.name} (${c.affinity.toFixed(2)})`).join(", ")}`,
      ),
      g.positioningTags?.length ? `- Where this audience differs from the comparable's: ${g.positioningTags.join(", ")}` : "",
    );
  }
  return lines.filter(Boolean).join("\n");
}

/** The campaign model: drafts and polishes plans through any ChatClient. */
const CHOOSER = "You are a senior marketing strategist. A taste-data API checks every idea you give for this audience. Return only JSON.";
const Choices = z.object({
  choices: z.array(z.object({ from: z.string().max(200), to: z.string().max(200), why: z.string().max(400), own: z.boolean().optional() })).max(20),
});

export class LiveLLM implements LLMProvider {
  readonly id: string;
  readonly label: string;
  readonly scripted = false;

  constructor(private readonly chat: ChatClient) {
    this.id = chat.id;
    this.label = chat.model;
  }

  private complete(user: string): Promise<string> {
    return this.chat.complete(SYSTEM, user);
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

  /**
   * For each rejected pick, choose one of the Qloo-approved options that best fits
   * the brief, or propose an own idea. The model decides; the caller accepts a
   * listed option as is and an own idea only after Qloo scores it above the bar.
   */
  async choose(replacements: Replacement[], input: DraftInput): Promise<Choice[]> {
    const prompt = [
      `Brief: ${input.brief.subject}: ${input.brief.product}. Goal: ${input.brief.goal}`,
      "Qloo's taste check rejected these picks. For each, choose the replacement that best serves this brief from the Qloo-approved options (affinity for this audience in brackets).",
      'If none of the options fits the brief, you may instead propose one real name of your own of the same kind and set "own": true. Qloo scores it for this audience; it is kept only if it clears the same bar, otherwise Qloo\'s top option is used.',
      ...replacements.map((r) => `- ${r.role} "${r.from}" (${r.reason}) → options: ${(r.options ?? [{ name: r.to, affinity: NaN }]).map((o) => `${o.name} [${Number.isNaN(o.affinity) ? "?" : o.affinity.toFixed(2)}]`).join(", ")}`),
      'Return only JSON: {"choices": [{"from": string, "to": string, "why": string (one short sentence), "own": boolean (true only for your own idea)}]}',
    ].join("\n");
    const raw = extractJson(await this.chat.complete(CHOOSER, prompt));
    const parsed = Choices.safeParse(raw);
    if (!parsed.success) throw new LLMOutputError("choices are not in the required shape");
    return parsed.data.choices;
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
