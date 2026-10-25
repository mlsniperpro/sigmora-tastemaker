/**
 * The owner's credentials for real shipping. Scripts send the raw key in a
 * header; a browser signs in once (POST /api/owner) and then carries a
 * session token in an httpOnly cookie: `<expiry seconds>.<HMAC-SHA256>`, keyed
 * by the owner key, so the cookie never holds the key itself, expires on its
 * own, and dies when the key is rotated.
 */
import { createHash, createHmac, timingSafeEqual } from "node:crypto";

/** Where the owner's key travels: a header (scripts, curl) or the session cookie set by /api/owner. */
export const OWNER_HEADER = "x-tastemaker-owner";
export const OWNER_COOKIE = "tm_owner";
export const OWNER_SESSION_SECONDS = 30 * 24 * 3600;
/** Owner-key attempts (sign-ins and header keys) per IP per minute, so the key can't be guessed online. */
export const OWNER_ATTEMPTS_PER_MINUTE = 5;

/** Constant-time comparison (hashing first makes the lengths equal). */
export function sameKey(a: string, b: string): boolean {
  const h = (s: string) => createHash("sha256").update(s).digest();
  return timingSafeEqual(h(a), h(b));
}

const mac = (ownerKey: string, exp: number) => createHmac("sha256", ownerKey).update(`tastemaker-owner:${exp}`).digest("base64url");

/** A session token valid until `now + ttl`. */
export function ownerToken(ownerKey: string, now = Date.now(), ttlSeconds = OWNER_SESSION_SECONDS): string {
  const exp = Math.floor(now / 1000) + ttlSeconds;
  return `${exp}.${mac(ownerKey, exp)}`;
}

/** True only for an unexpired token signed with this owner key; malformed input is simply false. */
export function validOwnerToken(token: string, ownerKey: string, now = Date.now()): boolean {
  const m = /^(\d{1,12})\.([A-Za-z0-9_-]{43})$/.exec(token);
  if (!m?.[1] || !m[2]) return false;
  const exp = Number(m[1]);
  if (exp * 1000 <= now) return false;
  return sameKey(m[2], mac(ownerKey, exp));
}

/** What the request presents as the owner: the raw key in the header, a session token in the cookie, or nothing. */
export type OwnerCredential = { kind: "key"; value: string } | { kind: "token"; value: string };

export function ownerCredentialOf(headers: Headers): OwnerCredential | undefined {
  const header = headers.get(OWNER_HEADER)?.trim();
  if (header) return { kind: "key", value: header };
  const cookie = headers
    .get("cookie")
    ?.split(";")
    .map((c) => c.trim())
    .find((c) => c.startsWith(`${OWNER_COOKIE}=`));
  if (cookie === undefined) return undefined;
  // Tokens are plain ASCII, so no decoding (and nothing to throw on a malformed cookie).
  return { kind: "token", value: cookie.slice(OWNER_COOKIE.length + 1) };
}

export function ownerCredentialValid(c: OwnerCredential, ownerKey: string, now = Date.now()): boolean {
  return c.kind === "key" ? sameKey(c.value, ownerKey) : validOwnerToken(c.value, ownerKey, now);
}

/**
 * Cross-site POST guard for the routes that can act as the owner. A browser
 * always sends Origin on a cross-origin POST; when it does, it must match the
 * host the request was sent to. Scripts without Origin pass (they carry the
 * header key, never the cookie).
 */
export function sameOrigin(req: Request): boolean {
  const origin = req.headers.get("origin");
  if (origin === null) return true;
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? new URL(req.url).host;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

export const crossSiteResponse = () => Response.json({ error: "Cross-site requests aren't accepted here." }, { status: 403 });
