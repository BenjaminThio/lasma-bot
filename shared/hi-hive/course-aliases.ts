// Each inner array is one equivalence group - all codes in it are "the same class".
// Add more groups / codes as you discover them.
const EQUIVALENCE_GROUPS: string[][] = [
  ["MPU3182"],
  ["MPU33213", "EPU33213"],
  ["UECS2523"]
];

// Build a lookup: code => canonical code (the first code in its group).
const CANONICAL: Record<string, string> = (() => {
  const map: Record<string, string> = {};
  for (const group of EQUIVALENCE_GROUPS) {
    const canonical = group[0].toUpperCase();
    for (const code of group) map[code.toUpperCase()] = canonical;
  }
  return map;
})();

/**
 * Normalise a course code to its canonical form. Codes not in any equivalence
 * group return unchanged (just uppercased/trimmed).
 */
export function canonicalCode(code: string | null | undefined): string {
  const c = (code ?? "").toUpperCase().trim();
  return CANONICAL[c] ?? c;
}

/** True if two course codes refer to the same class (directly or via a group). */
export function sameCourse(a: string | null | undefined, b: string | null | undefined): boolean {
  return canonicalCode(a) === canonicalCode(b);
}