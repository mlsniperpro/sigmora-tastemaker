import type { z } from "zod";

/** One readable line for a validation failure: "field.path: message; …" (never echoes input values). */
export function formatZodIssues(err: z.ZodError, opts: { root?: string; max?: number } = {}): string {
  return err.issues
    .slice(0, opts.max ?? 10)
    .map((i) => `${i.path.join(".") || (opts.root ?? "input")}: ${i.message}`)
    .join("; ");
}
