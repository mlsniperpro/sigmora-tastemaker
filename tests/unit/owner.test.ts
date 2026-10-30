/** Owner session tokens and the same-origin guard: pure functions, including hostile input. */
import { describe, expect, it } from "vitest";
import { fc, test } from "@fast-check/vitest";
import { OWNER_COOKIE, OWNER_HEADER, ownerCredentialOf, ownerToken, sameOrigin, validOwnerToken } from "@/lib/publisher/owner";

const KEY = "o".repeat(40);
const T0 = Date.parse("2026-10-25T00:00:00Z");

describe("owner session tokens", () => {
  it("accepts its own unexpired token and nothing else", () => {
    const t = ownerToken(KEY, T0, 3600);
    expect(validOwnerToken(t, KEY, T0)).toBe(true);
    expect(validOwnerToken(t, KEY, T0 + 3600_000)).toBe(false);
    expect(validOwnerToken(t, "p".repeat(40), T0)).toBe(false);
    expect(validOwnerToken(KEY, KEY, T0)).toBe(false);
    // Moving the expiry forward breaks the signature.
    const [exp, sig] = t.split(".");
    expect(validOwnerToken(`${Number(exp) + 86400}.${sig}`, KEY, T0)).toBe(false);
  });

  test.prop([fc.string({ maxLength: 200 })])("never throws and never accepts arbitrary input", (s) => {
    expect(validOwnerToken(s, KEY, T0)).toBe(false);
  });

  test.prop([fc.string({ minLength: 32, maxLength: 80 }), fc.integer({ min: 1, max: 10 ** 7 })])("round-trips for any key and lifetime", (key, ttl) => {
    expect(validOwnerToken(ownerToken(key, T0, ttl), key, T0)).toBe(true);
  });
});

describe("ownerCredentialOf", () => {
  it("prefers the header key, then the session cookie, without decoding it", () => {
    expect(ownerCredentialOf(new Headers({ [OWNER_HEADER]: " k ", cookie: `${OWNER_COOKIE}=t` }))).toEqual({ kind: "key", value: "k" });
    expect(ownerCredentialOf(new Headers({ cookie: `a=1; ${OWNER_COOKIE}=%E0%A4%A` }))).toEqual({ kind: "token", value: "%E0%A4%A" });
    expect(ownerCredentialOf(new Headers({ cookie: "a=1" }))).toBeUndefined();
    expect(ownerCredentialOf(new Headers())).toBeUndefined();
  });
});

describe("sameOrigin", () => {
  const req = (headers: Record<string, string>) => new Request("https://tastemaker.example/api/ship", { method: "POST", headers });
  it("passes requests without Origin and same-host Origins; refuses others and junk", () => {
    expect(sameOrigin(req({}))).toBe(true);
    expect(sameOrigin(req({ origin: "https://tastemaker.example" }))).toBe(true);
    expect(sameOrigin(req({ origin: "https://evil.example" }))).toBe(false);
    expect(sameOrigin(req({ origin: "null" }))).toBe(false);
    expect(sameOrigin(req({ origin: "https://a.example", "x-forwarded-host": "a.example" }))).toBe(true);
  });
});
