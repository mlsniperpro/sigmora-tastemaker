import { DeterministicLLM } from "./deterministic";
import { LiveLLM, type WireFormat } from "./live";
import type { LLMProvider } from "./types";

/**
 * LLM_PROVIDER: "deterministic" | "openai" | "anthropic" | "openai-compatible"
 * (anything else is treated as OpenAI-compatible). LLM_MODEL, LLM_API_KEY and
 * LLM_BASE_URL complete the config. No key → the scripted offline model.
 */
export function llmFromEnv(env: Record<string, string | undefined> = process.env): LLMProvider {
  const provider = (env.LLM_PROVIDER ?? "").toLowerCase();
  const apiKey = env.LLM_API_KEY;
  if (!apiKey || !env.LLM_MODEL || provider === "deterministic" || provider === "") return new DeterministicLLM();
  const format: WireFormat = provider === "anthropic" ? "anthropic" : "openai";
  return new LiveLLM({ format, model: env.LLM_MODEL, apiKey, baseUrl: env.LLM_BASE_URL || undefined });
}

export type { LLMProvider } from "./types";
