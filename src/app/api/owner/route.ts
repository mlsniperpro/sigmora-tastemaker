import { z } from "zod";
import { loadConfig } from "@/lib/config";
import { defaultCounter, incrPerMinute } from "@/lib/counter";
import { clientIp } from "@/lib/guard";
import { OWNER_COOKIE, OWNER_SESSION_SECONDS, crossSiteResponse, ownerToken, sameKey, sameOrigin } from "@/lib/publisher/owner";

const OwnerRequest = z.object({ key: z.string().min(1).max(200) });

/** Sign-in attempts per IP per minute, so the key can't be guessed online. */
export const OWNER_ATTEMPTS_PER_MINUTE = 5;

/**
 * The owner signs this browser in for real shipping: POST {key} sets an
 * httpOnly, SameSite=Strict cookie holding a signed, expiring session token
 * (never the key) that only /api routes receive. Visitors without it always
 * get the sandbox publisher. DELETE signs out.
 */
export async function POST(req: Request) {
  if (!sameOrigin(req)) return crossSiteResponse();
  const now = Date.now();
  if ((await incrPerMinute(defaultCounter(), `rl:owner:${clientIp(req.headers)}`, now)) > OWNER_ATTEMPTS_PER_MINUTE) {
    return Response.json({ error: "Too many sign-in attempts. Wait a minute." }, { status: 429, headers: { "Retry-After": String(60 - Math.floor((now / 1000) % 60)) } });
  }
  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return Response.json({ error: "Body must be JSON" }, { status: 400 });
  }
  const body = OwnerRequest.safeParse(json);
  if (!body.success) return Response.json({ error: "Send {\"key\": \"…\"}" }, { status: 400 });
  const ownerKey = loadConfig().SIGMORA_OWNER_KEY;
  if (!ownerKey || !sameKey(body.data.key, ownerKey)) return Response.json({ error: "That owner key isn't valid." }, { status: 403 });
  return Response.json({ ok: true }, { headers: { "set-cookie": cookie(ownerToken(ownerKey, now), OWNER_SESSION_SECONDS) } });
}

export function DELETE(req: Request) {
  if (!sameOrigin(req)) return crossSiteResponse();
  return Response.json({ ok: true }, { headers: { "set-cookie": cookie("", 0) } });
}

const cookie = (value: string, maxAge: number) => `${OWNER_COOKIE}=${value}; Path=/api; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAge}`;
