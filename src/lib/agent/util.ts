/** Words that don't distinguish one name from another ("The Weeknd", "Arsenal F.C."). */
const NOISE = new Set(["the", "fc"]);

const pairAt = (t: readonly string[]) => t.findIndex((x, k) => x === "f" && t[k + 1] === "c");

/** Canonical form for name matching. Idempotent: normName(normName(s)) === normName(s). */
export function normName(s: string): string {
  const tokens = s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/['’]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter((t) => t && !NOISE.has(t));
  // "F.C." arrives as the tokens "f", "c": drop such pairs until none is left (each pass shortens the list).
  for (let i = pairAt(tokens); i !== -1; i = pairAt(tokens)) tokens.splice(i, 2);
  return tokens.join(" ");
}

/** Roman numerals I–XXXIX, the range sequels and editions use (strict, so "mix", "dc" or "civil" never count). */
const ROMAN = /^(x{0,3})(ix|iv|v?i{0,3})$/;

/** The number a token stands for, when it is one: digits ("2", "182") or a roman numeral ("ii", "vii"). */
export function numeralValue(token: string): number | undefined {
  if (/^\d+$/.test(token)) return Number(token);
  const m = ROMAN.exec(token);
  if (!m || !token) return undefined;
  const tens = (m[1] ?? "").length * 10;
  const unit = m[2] ?? "";
  const units = unit === "ix" ? 9 : unit === "iv" ? 4 : (unit.startsWith("v") ? 5 : 0) + unit.replace("v", "").length;
  return tens + units;
}

/** A name's tokens, in order, with every numeral written one way ("ii" and "2" both become "#2"). */
const canonical = (normed: string) =>
  normed
    .split(" ")
    .map((t) => {
      const n = numeralValue(t);
      return n === undefined ? t : `#${String(n)}`;
    })
    .join(" ");

/**
 * Is a search hit the entity the model named? Search is fuzzy and will
 * happily return *something* for an invented name, so the names must be the
 * same: equal after normalising case, accents, punctuation, "the", "F.C." and
 * how numerals are written ("Boyz II Men" is "Boyz 2 Men"). Nothing looser:
 * "Black Panther Wakanda Rising" is not "Black Panther: Wakanda Forever", and
 * "Grand Theft Auto VII" is not "Grand Theft Auto V". (Subtitles dropped from
 * a real title are handled separately, by isTitlePart.)
 */
export function sameName(a: string, b: string): boolean {
  const x = normName(a);
  const y = normName(b);
  if (!x || !y) return false;
  return x === y || canonical(x) === canonical(y);
}

/**
 * Is `short` a full title with a subtitle or qualifier dropped ("Wakanda Forever" in "Black Panther:
 * Wakanda Forever")? Two or more whole words, in order. A single word ("Boy") never counts.
 */
export function isTitlePart(short: string, full: string): boolean {
  const s = normName(short);
  const f = normName(full);
  return s.split(" ").length >= 2 && s !== f && ` ${f} `.includes(` ${s} `);
}

export function median(xs: number[]): number {
  if (!xs.length) return 0;
  // `+ 0` turns -0 into +0, so the result can't depend on input order (the sort treats them as equal).
  const s = xs.map((x) => x + 0).sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  const hi = s[m] ?? 0;
  return s.length % 2 ? hi : ((s[m - 1] ?? hi) + hi) / 2;
}

/** A fresh, URL-safe id for one run (16 hex chars from the platform CSPRNG). */
export function newRunId(): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}
