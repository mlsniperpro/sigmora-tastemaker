/** The browser bundle stays light: nothing a client component imports (at runtime) pulls in zod or server-only code. */
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = resolve(__dirname, "../..");
const SERVER_ONLY = ["zod", "node:", "../config", "/config", "qloo/client", "llm/live", "llm/chat", "runCache"];

/** Runtime import specifiers of a source file: `import type …` and all-`type` named imports are skipped. */
function runtimeImports(file: string): string[] {
  const src = readFileSync(file, "utf8");
  return [...src.matchAll(/^import\s+([^;]*?)\s*from\s+["']([^"']+)["']|^import\s+["']([^"']+)["']/gm)].flatMap((m) => {
    const clause = (m[1] ?? "").trim();
    const spec = m[2] ?? m[3] ?? "";
    const typeOnly =
      clause.startsWith("type ") ||
      (clause.startsWith("{") && clause.slice(1, -1).split(",").every((part) => part.trim() === "" || part.trim().startsWith("type ")));
    return typeOnly ? [] : [spec];
  });
}

function resolveLocal(from: string, spec: string): string | undefined {
  const base = spec.startsWith("@/") ? join(ROOT, "src", spec.slice(2)) : spec.startsWith(".") ? resolve(dirname(from), spec) : undefined;
  if (!base) return undefined;
  return [base, `${base}.ts`, `${base}.tsx`, join(base, "index.ts")].find((p) => existsSync(p) && !p.endsWith("/"));
}

describe("client bundle", () => {
  it("client components never reach zod or server modules at runtime", () => {
    const seen = new Set<string>();
    const offending: string[] = [];
    const visit = (file: string, path: string[]) => {
      if (seen.has(file)) return;
      seen.add(file);
      for (const spec of runtimeImports(file)) {
        if (SERVER_ONLY.some((s) => spec === s || spec.startsWith(s) || spec.endsWith(s))) offending.push(`${[...path, file.replace(ROOT, "")].join(" → ")} imports ${spec}`);
        const next = resolveLocal(file, spec);
        if (next && /\.(ts|tsx)$/.test(next)) visit(next, [...path, file.replace(ROOT, "")]);
      }
    };
    const dir = join(ROOT, "src/components");
    for (const f of readdirSync(dir)) visit(join(dir, f), []);
    expect(offending).toEqual([]);
  });
});
