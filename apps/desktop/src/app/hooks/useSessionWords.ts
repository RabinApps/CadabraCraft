import { useRef } from "react";
import { sessionWords } from "../../lib/sessionWords";

/** Words written since the book was opened: the first book total seen for this project is the baseline. Null until the book is counted. */
export function useSessionWords(root: string | null, bookWords: number | null): number | null {
  const baseline = useRef<{ root: string; words: number } | null>(null);
  if (root === null || bookWords === null) return null;
  if (baseline.current?.root !== root) baseline.current = { root, words: bookWords };
  return sessionWords(baseline.current.words, bookWords);
}
