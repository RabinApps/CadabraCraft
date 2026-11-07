import { create } from "zustand";
import type { EntryWords } from "../lib/page/pageNumbering";

/**
 * The words of every page of the open book in reading order: the input of the page layout (`bookLayout`) besides what Typst and the
 * editors measured. Null until the first count. A refresh keeps the last words until the new ones arrive, so a page number never
 * drops back to a placeholder while the book is counted again.
 */
export const useBookWords = create<{ words: EntryWords[] | null }>(() => ({ words: null }));

let queued = false;
let token = 0;

/**
 * Counts again with `load`. Every surface that shows page numbers asks when the book changes; asks in the same tick share one count,
 * and an answer that was overtaken by a later ask is dropped. A failed count leaves the words as they were.
 */
export function refreshBookWords(load: () => Promise<EntryWords[]>): void {
  if (queued) return;
  queued = true;
  queueMicrotask(() => {
    queued = false;
    const mine = ++token;
    load().then(
      (words) => mine === token && useBookWords.setState({ words }),
      () => undefined,
    );
  });
}

/** Forgets the words (the book was closed). */
export const clearBookWords = (): void => {
  token++;
  useBookWords.setState({ words: null });
};
