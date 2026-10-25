import type { z } from "zod";

/** One readable line for a validation failure: "field.path: message; …" (never echoes input values). */
export function formatZodIssues(err: z.ZodError, opts: { root?: string; max?: number } = {}): string {
  return err.issues
    .slice(0, opts.max ?? 10)
    .map((i) => `${i.path.join(".") || (opts.root ?? "input")}: ${i.message}`)
    .join("; ");
}

/** A UTF-16 surrogate without its pair: not text, and it breaks URL encoding downstream. */
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

/** True when any string in a parsed JSON body holds a lone surrogate (checked before validation, so it's a 400, never a crash later). */
export function hasLoneSurrogate(value: unknown, depth = 0): boolean {
  if (depth > 64) return false;
  if (typeof value === "string") return LONE_SURROGATE.test(value);
  if (Array.isArray(value)) return value.some((v) => hasLoneSurrogate(v, depth + 1));
  if (value && typeof value === "object") return Object.entries(value).some(([k, v]) => LONE_SURROGATE.test(k) || hasLoneSurrogate(v, depth + 1));
  return false;
}

export const MALFORMED_TEXT = "Text contains an invalid character (a broken emoji or encoding); please retype it.";
