import { describe, expect, it } from "vitest";
import { z } from "zod";
import { formatZodIssues } from "@/lib/zod";

describe("formatZodIssues", () => {
  const S = z.object({ a: z.object({ b: z.number() }), c: z.string().min(2) });
  it("names each failing path, never the offending value", () => {
    const err = S.safeParse({ a: { b: "secret-value" }, c: "x" }).error!;
    const text = formatZodIssues(err);
    expect(text).toMatch(/^a\.b: .+; c: .+$/);
    expect(text).not.toContain("secret-value");
  });
  it("labels root errors and caps the count", () => {
    expect(formatZodIssues(S.safeParse(null).error!, { root: "body" })).toMatch(/^body: /);
    const many = z.array(z.number()).safeParse(["a", "b", "c", "d"]).error!;
    expect(formatZodIssues(many, { max: 2 }).split("; ")).toHaveLength(2);
  });
});
