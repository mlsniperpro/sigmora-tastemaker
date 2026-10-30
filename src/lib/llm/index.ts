import { loadConfig, type Env } from "../config";
import { HttpChat, type ChatClient, type WireFormat } from "./chat";
import { DeterministicLLM } from "./deterministic";
import { LiveLLM } from "./live";
import type { LLMProvider } from "./types";

interface ModelEnv {
  provider?: string;
  model?: string;
  apiKey?: string;
  baseUrl?: string;
  timeoutMs: number;
  effort?: Env["LLM_EFFORT"];
}

/**
 * A chat client for a provider/model/key triple, or undefined when it isn't
 * fully configured. Provider "anthropic" speaks the Messages API; anything
 * else (openai, openai-compatible, groq, …) speaks OpenAI chat completions.
 */
export function chatFromModelEnv(m: ModelEnv): ChatClient | undefined {
  const provider = (m.provider ?? "").toLowerCase();
  if (!m.apiKey || !m.model || provider === "" || provider === "deterministic") return undefined;
  const format: WireFormat = provider === "anthropic" ? "anthropic" : "openai";
  return new HttpChat({ format, model: m.model, apiKey: m.apiKey, baseUrl: m.baseUrl, timeoutMs: m.timeoutMs, effort: m.effort });
}

const campaignModel = (env: Env): ModelEnv => ({ provider: env.LLM_PROVIDER, model: env.LLM_MODEL, apiKey: env.LLM_API_KEY, baseUrl: env.LLM_BASE_URL, timeoutMs: env.LLM_TIMEOUT_MS, effort: env.LLM_EFFORT });

/** LLM_PROVIDER / LLM_MODEL / LLM_API_KEY / LLM_BASE_URL; not fully set → the scripted offline model. */
export function llmFromEnv(raw: Record<string, string | undefined> = process.env): LLMProvider {
  const chat = chatFromModelEnv(campaignModel(loadConfig(raw)));
  return chat ? new LiveLLM(chat) : new DeterministicLLM();
}

/**
 * The benchmark judge: JUDGE_PROVIDER / JUDGE_MODEL / JUDGE_API_KEY /
 * JUDGE_BASE_URL. Unset values fall back to the campaign model's only when
 * the judge runs on the same provider, so a key is never sent to another
 * vendor's host. Undefined when no judge model is fully configured.
 */
export function judgeChatFromEnv(raw: Record<string, string | undefined> = process.env): ChatClient | undefined {
  const env = loadConfig(raw);
  const base = campaignModel(env);
  const provider = env.JUDGE_PROVIDER ?? base.provider;
  const inherit = provider === base.provider;
  return chatFromModelEnv({
    provider,
    model: env.JUDGE_MODEL ?? (inherit ? base.model : undefined),
    apiKey: env.JUDGE_API_KEY ?? (inherit ? base.apiKey : undefined),
    baseUrl: env.JUDGE_BASE_URL ?? (inherit ? base.baseUrl : undefined),
    timeoutMs: env.LLM_TIMEOUT_MS,
  });
}

export type { LLMProvider } from "./types";
