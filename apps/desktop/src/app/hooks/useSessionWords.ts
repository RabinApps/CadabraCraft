import { useRef } from "react";
import { sessionWords } from "../../lib/sessionWords";

/**
 * Words written since the book was opened: the first book total seen for this project and language is the baseline
 * (another language is another text, so its count starts over). Null until the book is counted; closing the book
 * forgets the baseline, so opening it again starts a new session.
 */
export function useSessionWords(
  root: string | null,
  language: string,
  bookWords: number | null,
): number | null {
  const baseline = useRef<{ key: string; words: number } | null>(null);
  if (root === null) {
    baseline.current = null;
    return null;
  }
  if (bookWords === null) return null;
  const key = `${root}\u0000${language}`;
  if (baseline.current?.key !== key) baseline.current = { key, words: bookWords };
  return sessionWords(baseline.current.words, bookWords);
}
