/** Test helper: unwrap an indexed value, failing loudly instead of with a TypeError later. */
export function must<T>(x: T | null | undefined, what = "value"): T {
  if (x === undefined || x === null) throw new Error(`expected ${what} to be present`);
  return x;
}

/** The JSON body a stubbed fetch received (request bodies in these tests are always strings). */
export function sentJson(init: RequestInit | undefined): unknown {
  if (typeof init?.body !== "string") throw new Error("expected a string request body");
  return JSON.parse(init.body);
}
