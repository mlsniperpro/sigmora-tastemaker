/** Permalinks: a brief is stored in the URL as base64url-encoded UTF-8 JSON. */
import { Brief, type BriefInput, type RunRequest } from "./agent/brief";
import { PRESETS } from "./agent/presets";
import { CampaignId } from "./ids";

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

/** What a page load runs: a valid `?b=` brief, else a known `?preset=`, else the hero preset. */
export function requestFromUrl(params: { get(name: string): string | null }): RunRequest {
  const b = params.get("b");
  const brief = b ? decodeBrief(b) : undefined;
  if (brief) return { brief };
  const preset = params.get("preset");
  return { preset: PRESETS.find((p) => p.id === preset)?.id ?? PRESETS[0].id };
}

/** `?measure=<campaign id>`: measure a shipped campaign and re-run with what performed. */
export function measureFromUrl(params: { get(name: string): string | null }): string | undefined {
  const r = CampaignId.safeParse(params.get("measure"));
  return r.success ? r.data : undefined;
}

/** `?run=<id>`: open a finished run exactly as it was. */
export function runIdFromUrl(params: { get(name: string): string | null }): string | undefined {
  const id = params.get("run");
  return id && /^[a-z0-9]{1,40}$/.test(id) ? id : undefined;
}
