/**
 * Spreads of the print preview, as a book opens: page 1 (a right-hand page) alone, then facing pairs (2, 3), (4, 5)... Pages are
 * 1-based physical pages of the PDF; a missing page is null (the left of the first spread, the right of the last when the count is even).
 */
export type Spread = readonly [left: number | null, right: number | null];

/** How many spreads a PDF of `total` pages has. */
export const spreadCount = (total: number): number => (total > 0 ? Math.floor(total / 2) + 1 : 0);

/** The pages of spread `index` (0-based), clamped into range. */
export function spreadPages(index: number, total: number): Spread {
  const n = spreadCount(total);
  if (n === 0) return [null, null];
  const i = Math.min(Math.max(0, Math.floor(index)), n - 1);
  if (i === 0) return [null, 1];
  const left = 2 * i;
  return [left, left + 1 <= total ? left + 1 : null];
}

/** "Page 3" or "Pages 4 and 5" for the pages of a spread. */
export function spreadLabel(s: Spread): number[] {
  return s.filter((p): p is number => p !== null);
}
