/** A tiny text-metrics model: how many lines a paragraph takes without measuring a DOM. Used for calibration against Typst and as a fallback estimate. */

/**
 * Average advance of one character (letters, punctuation and spaces mixed, running prose) as a fraction of the font size, for ragged text.
 * Calibrated against the Typst output (see the block at the top of pageLayout.ts): it is an effective value for line counting, a little
 * smaller than the true glyph average because Typst hyphenates and fills lines tightly.
 */
export const AVG_CHAR_EM = { serif: 0.425, sans: 0.455 } as const;
export type FontKind = keyof typeof AVG_CHAR_EM;
/** Justified (and hyphenated) text packs about 3% more characters on a line than ragged text. */
export const JUSTIFY_GAIN = 0.97;

export const avgCharEm = (kind: FontKind, justified: boolean): number =>
  AVG_CHAR_EM[kind] * (justified ? JUSTIFY_GAIN : 1);

/** Greedy word wrap on character counts. `firstIndentPx` shortens the first line. Empty text is 0 lines. */
export function estimateLines(
  text: string,
  widthPx: number,
  fontPx: number,
  avgCharEm: number,
  firstIndentPx = 0,
): number {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0) return 0;
  const charPx = Math.max(1e-6, avgCharEm * fontPx);
  const cap = (first: boolean): number =>
    Math.max(1, (widthPx - (first ? firstIndentPx : 0)) / charPx);
  let lines = 1;
  let used = 0;
  for (const w of words) {
    const need = used === 0 ? w.length : used + 1 + w.length;
    if (need <= cap(lines === 1) || used === 0) used = need;
    else {
      lines += 1;
      used = w.length;
    }
    // A word longer than the line wraps onto extra lines.
    while (used > cap(lines === 1)) {
      used -= cap(lines === 1);
      lines += 1;
    }
  }
  return lines;
}
