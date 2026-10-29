/** How far below the top of the scroll area a section's heading rests after a jump (matches the page padding on a phone). */
export const SECTION_TOP_GAP = 16;

/** A section counts as the current one once its top has passed this far below the top of the scroll area. */
export const SPY_LINE = 96;

/**
 * Which section the Settings nav should highlight: the last one whose top (in px from the top of the scroll area, in order) has
 * reached `SPY_LINE`, the first when none has, and the last when the page is scrolled to the end (so a short last section that can
 * never reach the line still gets its turn).
 */
export function currentSection(tops: readonly number[], atEnd: boolean): number {
  if (tops.length === 0) return 0;
  if (atEnd) return tops.length - 1;
  let current = 0;
  tops.forEach((top, i) => {
    if (top <= SPY_LINE) current = i;
  });
  return current;
}
