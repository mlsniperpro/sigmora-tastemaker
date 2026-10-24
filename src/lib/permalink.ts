/**
 * Permalinks: a brief is stored in the URL as base64url-encoded UTF-8 JSON.
 * Browser-side, a `?b=` brief only gets a structural check (zod stays out of
 * the client bundle); the server validates every brief before it runs.
 */
import type { BriefInput, RunRequest } from "./agent/brief";
import { PRESETS } from "./agent/presets";
import { AGE_BUCKETS, CAMPAIGN_ID_RE, FAMILIES, RUN_ID_RE } from "./vocab";

const isStrings = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === "string");
// Mirrors the schema's min(1): the server decides what else is acceptable.
const nonEmpty = (v: unknown): v is string => typeof v === "string" && v.length > 0;

/** Structural check: the fields a brief must have, with the right kinds of values. */
function looksLikeBrief(v: unknown): v is BriefInput {
  if (typeof v !== "object" || v === null) return false;
  const b = v as Record<string, unknown>;
  const links = b.seedLinks === undefined ? [] : b.seedLinks;
  return (
    FAMILIES.some((f) => f === b.family) &&
    nonEmpty(b.subject) &&
    nonEmpty(b.product) &&
    nonEmpty(b.goal) &&
    isStrings(b.seeds) &&
    isStrings(links) &&
    b.seeds.length + links.length > 0 &&
    isStrings(b.ages) &&
    b.ages.length > 0 &&
    b.ages.every((a) => AGE_BUCKETS.some((x) => x === a))
  );
}

export function encodeBrief(b: BriefInput): string {
  const bytes = new TextEncoder().encode(JSON.stringify(b));
  let bin = "";
  for (const x of bytes) bin += String.fromCharCode(x);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Returns the brief in a `?b=` value, or undefined for anything malformed (the URL is user input). */
export function decodeBrief(s: string): BriefInput | undefined {
  try {
    const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/"));
    const json: unknown = JSON.parse(new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0))));
    return looksLikeBrief(json) ? json : undefined;
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
  const id = params.get("measure");
  return id && CAMPAIGN_ID_RE.test(id) ? id : undefined;
}

/** `?run=<id>`: open a finished run exactly as it was. */
export function runIdFromUrl(params: { get(name: string): string | null }): string | undefined {
  const id = params.get("run");
  return id && RUN_ID_RE.test(id) ? id : undefined;
}
