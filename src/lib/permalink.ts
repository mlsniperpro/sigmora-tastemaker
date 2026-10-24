/** Permalinks: a brief is stored in the URL as base64url-encoded UTF-8 JSON. */
import { Brief, type BriefInput } from "./agent/brief";

export function encodeBrief(b: BriefInput): string {
  const bytes = new TextEncoder().encode(JSON.stringify(b));
  let bin = "";
  for (const x of bytes) bin += String.fromCharCode(x);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Returns a validated brief, or undefined for anything malformed (the URL is user input). */
export function decodeBrief(s: string): BriefInput | undefined {
  try {
    const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/"));
    const json: unknown = JSON.parse(new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0))));
    const r = Brief.safeParse(json);
    return r.success ? r.data : undefined;
  } catch {
    return undefined;
  }
}
