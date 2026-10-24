/** LiveLLM over stubbed HTTP: both wire formats, retries, repair, timeouts and messy output. */
import { describe, expect, it, vi } from "vitest";
import { Brief } from "@/lib/agent/brief";
import { PRESETS } from "@/lib/agent/presets";
import { llmFromEnv } from "@/lib/llm";
import { LLMOutputError } from "@/lib/llm/coerce";
import { DeterministicLLM } from "@/lib/llm/deterministic";
import { LiveLLM, buildDraftPrompt } from "@/lib/llm/live";
import type { Draft } from "@/lib/llm/types";
import { HttpError, TimeoutError, type RetryPolicy } from "@/lib/net";

const brief = Brief.parse(PRESETS[0].brief);
const fastRetry: RetryPolicy = { retries: 2, baseMs: 1, maxMs: 5, sleep: async () => undefined };
const draft: Draft = {
  positioning: "p",
  hooks: ["Coors Light nights"],
  script: "s",
  captions: [{ platform: "X", text: "Coors Light" }],
  musicBrief: "m",
  picks: [{ name: "Coors Light", type: "brand", role: "sponsor", rationale: "" }],
};
const openai = (content: string) => Response.json({ choices: [{ message: { content } }] });
const live = (f: (url: string, init: RequestInit) => Promise<Response>, format: "openai" | "anthropic" = "openai", o: Partial<ConstructorParameters<typeof LiveLLM>[0]> = {}) =>
  new LiveLLM({ format, model: "m", apiKey: "k", baseUrl: format === "openai" ? "https://llm.example/v1" : undefined, fetchImpl: f as unknown as typeof fetch, retry: fastRetry, ...o });

describe("provider selection", () => {
  it("picks the provider from env and never pins a vendor", () => {
    expect(llmFromEnv({}).id).toBe("deterministic");
    expect(llmFromEnv({ LLM_PROVIDER: "anthropic", LLM_MODEL: "m", LLM_API_KEY: "k" }).id).toBe("anthropic:m");
    expect(llmFromEnv({ LLM_PROVIDER: "groq", LLM_MODEL: "m2", LLM_API_KEY: "k" }).id).toBe("openai:m2");
    expect(llmFromEnv({ LLM_PROVIDER: "openai", LLM_MODEL: "m" }).id).toBe("deterministic");
  });
});

describe("prompting", () => {
  it("puts Qloo grounding in the prompt only when grounded", () => {
    expect(buildDraftPrompt({ brief })).not.toMatch(/Qloo/);
    const p = buildDraftPrompt({ brief, grounding: { tags: ["afrobeats"], overIndexAges: ["25_to_29"], candidates: { collab: [{ name: "Ayra Starr", type: "artist", affinity: 0.9 }] } } });
    expect(p).toMatch(/Ayra Starr \(0\.90\)/);
    expect(p).toMatch(/Vibe: warm late-night/);
  });
});

describe("LiveLLM (OpenAI-compatible)", () => {
  it("posts to /chat/completions with a bearer token and parses the reply", async () => {
    const f = vi.fn(async () => openai(JSON.stringify(draft)));
    const d = await live(f).draft({ brief });
    expect(d.picks[0].name).toBe("Coors Light");
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://llm.example/v1/chat/completions");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer k");
  });

  it("retries 429 / 5xx with backoff, then succeeds", async () => {
    const replies = [new Response("busy", { status: 503 }), new Response("slow", { status: 429 }), openai(JSON.stringify(draft))];
    const f = vi.fn(async () => replies.shift()!);
    await live(f).draft({ brief });
    expect(f).toHaveBeenCalledTimes(3);
  });

  it("gives up after bounded retries with a typed error", async () => {
    const f = vi.fn(async () => new Response("down", { status: 503 }));
    await expect(live(f).draft({ brief })).rejects.toBeInstanceOf(HttpError);
    expect(f).toHaveBeenCalledTimes(3);
  });

  it("does not retry an auth failure", async () => {
    const f = vi.fn(async () => new Response("no", { status: 401 }));
    await expect(live(f).draft({ brief })).rejects.toMatchObject({ status: 401 });
    expect(f).toHaveBeenCalledTimes(1);
  });

  it("times out a hung call (typed) after its retries", async () => {
    const hang = vi.fn(
      (_u: string, init: RequestInit) => new Promise<Response>((_, reject) => init.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")))),
    );
    await expect(live(hang, "openai", { timeoutMs: 10, retry: { ...fastRetry, retries: 1 } }).draft({ brief })).rejects.toBeInstanceOf(TimeoutError);
    expect(hang).toHaveBeenCalledTimes(2);
  });

  it("asks once to repair unusable output, then fails with a typed error", async () => {
    const replies = ["not json", JSON.stringify(draft)];
    const f = vi.fn(async () => openai(replies.shift()!));
    await expect(live(f).draft({ brief })).resolves.toMatchObject({ hooks: ["Coors Light nights"] });
    expect(f).toHaveBeenCalledTimes(2);
    const bad = vi.fn(async () => openai("still not json"));
    await expect(live(bad).draft({ brief })).rejects.toBeInstanceOf(LLMOutputError);
    expect(bad).toHaveBeenCalledTimes(2);
  });

  it("coerces messy but usable output instead of failing the run", async () => {
    const messy = { ...draft, positioning: "x".repeat(900), picks: [{ name: "Insecure", type: "TV Show", role: "hook reference" }] };
    const d = await live(async () => openai("Here you go:\n```json\n" + JSON.stringify(messy) + "\n```")).draft({ brief });
    expect(d.positioning).toHaveLength(400);
    expect(d.picks[0]).toMatchObject({ type: "tv_show", role: "reference" });
  });

  it("drops response_format when the host rejects it", async () => {
    const bodies: Record<string, unknown>[] = [];
    const f = vi.fn(async (_u: string, init: RequestInit) => {
      const b = JSON.parse(String(init.body)) as Record<string, unknown>;
      bodies.push(b);
      return b.response_format ? new Response("Unsupported parameter: response_format", { status: 400 }) : openai(JSON.stringify(draft));
    });
    await live(f).draft({ brief });
    expect(bodies.map((b) => "response_format" in b)).toEqual([true, false]);
  });

  it("treats any other 400 as a real error and keeps JSON mode on", async () => {
    const bodies: Record<string, unknown>[] = [];
    const f = vi.fn(async (_u: string, init: RequestInit) => {
      bodies.push(JSON.parse(String(init.body)) as Record<string, unknown>);
      return new Response("maximum context length exceeded", { status: 400 });
    });
    await expect(live(f).draft({ brief })).rejects.toMatchObject({ status: 400 });
    expect(bodies).toHaveLength(1);
  });

  it("surfaces a failed rewrite to the caller instead of hiding it", async () => {
    const f = vi.fn(async () => new Response("down", { status: 503 }));
    await expect(live(f).revise(draft, [{ from: "Coors Light", to: "Apple Music", type: "brand", role: "sponsor", reason: "Qloo" }], { brief })).rejects.toBeInstanceOf(HttpError);
  });
});

describe("LiveLLM (Anthropic Messages)", () => {
  it("posts to /v1/messages with x-api-key and joins text blocks", async () => {
    const f = vi.fn(async () => Response.json({ content: [{ type: "text", text: "Here:\n" }, { type: "text", text: JSON.stringify(draft) }] }));
    await live(f, "anthropic").draft({ brief });
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.anthropic.com/v1/messages");
    expect((init.headers as Record<string, string>)["x-api-key"]).toBe("k");
    expect((init.headers as Record<string, string>)["anthropic-version"]).toBe("2023-06-01");
  });
  it("rejects a reply in the wrong shape", async () => {
    await expect(live(async () => Response.json({ unexpected: true }), "anthropic").draft({ brief })).rejects.toThrow();
  });
});

describe("DeterministicLLM", () => {
  it("drafts every role the brief needs", async () => {
    const d = await new DeterministicLLM().draft({ brief });
    expect(new Set(d.picks.map((p) => p.role))).toEqual(new Set(["collab", "sponsor", "reference", "podcast", "venue", "presenter", "city"]));
  });
});
