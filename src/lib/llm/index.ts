import { loadConfig } from "../config";
import { DeterministicLLM } from "./deterministic";
import { LiveLLM, type WireFormat } from "./live";
import type { LLMProvider } from "./types";

/**
 * LLM_PROVIDER: "deterministic" | "openai" | "anthropic" | "openai-compatible"
 * (anything else is treated as OpenAI-compatible). LLM_MODEL, LLM_API_KEY and
 * LLM_BASE_URL complete the config. No key or model → the scripted offline model.
 */
export function llmFromEnv(raw: Record<string, string | undefined> = process.env): LLMProvider {
  const env = loadConfig(raw);
  const provider = (env.LLM_PROVIDER ?? "").toLowerCase();
  if (!env.LLM_API_KEY || !env.LLM_MODEL || provider === "deterministic" || provider === "") return new DeterministicLLM();
  const format: WireFormat = provider === "anthropic" ? "anthropic" : "openai";
  return new LiveLLM({ format, model: env.LLM_MODEL, apiKey: env.LLM_API_KEY, baseUrl: env.LLM_BASE_URL, timeoutMs: env.LLM_TIMEOUT_MS });
}

export type { LLMProvider } from "./types";
