const WORDS_PER_MINUTE = 230;

/** Whole minutes to read `words`, at least 1 for any text and 0 for none. */
export function readingMinutes(words: number): number {
  return words <= 0 ? 0 : Math.max(1, Math.round(words / WORDS_PER_MINUTE));
}
