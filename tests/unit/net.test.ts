import { describe, it, vi, expect } from "vitest";
import { fc, test } from "@fast-check/vitest";
import { DEFAULT_RETRY, HttpError, TimeoutError, backoffMs, ensureOk, fetchWithTimeout, isRetryable, joinUrl, parseRetryAfter, withRetry, type RetryPolicy } from "@/lib/net";

const noSleep: RetryPolicy = { ...DEFAULT_RETRY, sleep: async () => undefined };

describe("isRetryable", () => {
  it.each([408, 425, 429, 500, 502, 503, 504])("retries HTTP %i", (status) => {
    expect(isRetryable(new HttpError("X", status, "/p"))).toBe(true);
  });
  it.each([400, 401, 403, 404, 422])("does not retry HTTP %i", (status) => {
    expect(isRetryable(new HttpError("X", status, "/p"))).toBe(false);
  });
  it("retries timeouts and network TypeErrors, not other errors", () => {
    expect(isRetryable(new TimeoutError("X", "/p", 10))).toBe(true);
    expect(isRetryable(new TypeError("fetch failed"))).toBe(true);
    expect(isRetryable(new Error("boom"))).toBe(false);
  });
});

describe("backoffMs", () => {
  test.prop([fc.nat(20), fc.integer({ min: 1, max: 5000 }), fc.integer({ min: 1, max: 60000 }), fc.double({ min: 0, max: 0.999999, noNaN: true })])(
    "full jitter stays within [0, min(max, base·2^n)]",
    (attempt, baseMs, maxMs, r) => {
      const ms = backoffMs(attempt, { retries: 3, baseMs, maxMs, random: () => r }, undefined);
      expect(ms).toBeGreaterThanOrEqual(0);
      expect(ms).toBeLessThanOrEqual(Math.min(maxMs, baseMs * 2 ** attempt));
    },
  );
  test.prop([fc.nat(10), fc.integer({ min: -1000, max: 100000 })])("honours Retry-After, clamped to [0, maxMs]", (attempt, retryAfter) => {
    const ms = backoffMs(attempt, { retries: 3, baseMs: 100, maxMs: 4000 }, retryAfter);
    expect(ms).toBe(Math.min(4000, Math.max(0, retryAfter)));
  });
});

describe("parseRetryAfter", () => {
  it("reads delta-seconds and HTTP dates", () => {
    expect(parseRetryAfter("3")).toBe(3000);
    const now = Date.parse("2026-10-24T10:00:00Z");
    expect(parseRetryAfter("Sat, 24 Oct 2026 10:00:05 GMT", now)).toBe(5000);
    expect(parseRetryAfter("Sat, 24 Oct 2026 09:00:00 GMT", now)).toBe(0);
  });
  test.prop([fc.option(fc.string(), { nil: null })])("never throws and never returns a negative or NaN", (h) => {
    const v = parseRetryAfter(h);
    expect(v === undefined || (Number.isFinite(v) && v >= 0)).toBe(true);
  });
});

describe("withRetry", () => {
  test.prop([fc.nat(4), fc.nat(6)])("makes at most retries+1 attempts and succeeds once failures run out", async (retries, failures) => {
    let calls = 0;
    const run = withRetry(async () => {
      calls++;
      if (calls <= failures) throw new HttpError("X", 503, "/p");
      return "ok";
    }, { ...noSleep, retries });
    if (failures <= retries) {
      await expect(run).resolves.toBe("ok");
      expect(calls).toBe(failures + 1);
    } else {
      await expect(run).rejects.toBeInstanceOf(HttpError);
      expect(calls).toBe(retries + 1);
    }
  });

  it("stops at once on a non-retryable error", async () => {
    let calls = 0;
    await expect(
      withRetry(async () => {
        calls++;
        throw new HttpError("X", 400, "/p");
      }, noSleep),
    ).rejects.toMatchObject({ status: 400 });
    expect(calls).toBe(1);
  });

  it("waits Retry-After between attempts", async () => {
    const sleeps: number[] = [];
    let calls = 0;
    await withRetry(
      async () => {
        if (calls++ === 0) throw new HttpError("X", 429, "/p", 1500);
        return 1;
      },
      { ...DEFAULT_RETRY, sleep: async (ms) => void sleeps.push(ms) },
    );
    expect(sleeps).toEqual([1500]);
  });
});

describe("fetchWithTimeout / ensureOk", () => {
  it("turns an abort into a typed TimeoutError", async () => {
    const hang = ((_u: unknown, init: RequestInit) =>
      new Promise((_, reject) => init.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError"))))) as unknown as typeof fetch;
    await expect(fetchWithTimeout(hang, "Qloo", "https://h.example/search?q=secret", {}, 20)).rejects.toMatchObject({
      name: "TimeoutError",
      path: "/search",
    });
  });

  it("passes network errors through untouched", async () => {
    const down = vi.fn(async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof fetch;
    await expect(fetchWithTimeout(down, "Qloo", "https://h.example/x", {}, 1000)).rejects.toBeInstanceOf(TypeError);
  });

  it("maps non-2xx to HttpError with the path only and the Retry-After", async () => {
    const res = new Response("slow down", { status: 429, headers: { "retry-after": "2" } });
    const err = await ensureOk(res, "Qloo", "https://h.example/v2/insights?signal.interests.entities=abc").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(HttpError);
    expect(err).toMatchObject({ status: 429, path: "/v2/insights", retryAfterMs: 2000 });
    expect((err as Error).message).not.toContain("abc");
  });

  it("lets 2xx through", async () => {
    const res = new Response("{}", { status: 200 });
    await expect(ensureOk(res, "Qloo", "https://h.example/")).resolves.toBe(res);
  });
});

describe("joinUrl", () => {
  test.prop([fc.webUrl({ withQueryParameters: false, withFragments: false }), fc.stringMatching(/^\/[a-z/]{0,20}$/), fc.nat(3)])("joins with exactly one slash however many the base ends with", (base, path, slashes) => {
    const trimmed = base.replace(/\/+$/, "");
    expect(joinUrl(trimmed + "/".repeat(slashes), path)).toBe(trimmed + path);
  });
});
