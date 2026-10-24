export function normName(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/['’]/g, "")
    .replace(/&/g, " and ")
    .replace(/\b(the|f\.?c\.?)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * Is a search hit the entity the model named? Search is fuzzy and will
 * happily return *something* for an invented name, so we require the names
 * to agree before accepting a hit.
 */
export function sameName(a: string, b: string): boolean {
  const x = normName(a);
  const y = normName(b);
  if (!x || !y) return false;
  if (x === y) return true;
  const tx = new Set(x.split(" "));
  const ty = new Set(y.split(" "));
  const inter = [...tx].filter((t) => ty.has(t)).length;
  return inter / Math.max(tx.size, ty.size) >= 0.75;
}

export function median(xs: number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Short, stable, non-cryptographic id (FNV-1a, 2 rounds). */
export function hashId(s: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < s.length; i++) {
    h1 = Math.imul(h1 ^ s.charCodeAt(i), 16777619);
    h2 = Math.imul(h2 ^ s.charCodeAt(i), 2246822519);
  }
  return ((h1 >>> 0).toString(36) + (h2 >>> 0).toString(36)).slice(0, 12);
}
