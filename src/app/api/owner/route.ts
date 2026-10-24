import { z } from "zod";
import { loadConfig } from "@/lib/config";
import { OWNER_COOKIE, sameKey } from "@/lib/publisher";

const OwnerRequest = z.object({ key: z.string().min(1).max(200) });

/**
 * The owner signs this browser in for real shipping: POST {key} sets an
 * httpOnly, SameSite=Strict cookie that only /api routes receive. Visitors
 * without it always get the sandbox publisher. DELETE signs out.
 */
export async function POST(req: Request) {
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
  return Response.json({ ok: true }, { headers: { "set-cookie": cookie(encodeURIComponent(body.data.key), 30 * 24 * 3600) } });
}

export function DELETE() {
  return Response.json({ ok: true }, { headers: { "set-cookie": cookie("", 0) } });
}

const cookie = (value: string, maxAge: number) => `${OWNER_COOKIE}=${value}; Path=/api; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAge}`;
