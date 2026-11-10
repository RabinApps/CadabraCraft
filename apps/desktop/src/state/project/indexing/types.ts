import type { GlossaryEntry } from "@cadabracraft/shared";
import type { GlossarySettings, IndexSettings } from "@cadabracraft/format";
import type { BookPage } from "../types";

/** The back-of-book index and the glossary: their settings, entries and the marks in the pages. Failures set `notice` and change nothing. */
export interface IndexActions {
  /** The pages of the shown edition in reading order, the open page as it is on screen (its unsaved typing included). */
  indexSources: () => Promise<BookPage[]>;
  /** Changes the index settings (`manifest.index`) and saves the manifest. */
  setIndexSettings: (patch: Partial<IndexSettings>) => Promise<void>;
  /** Changes the glossary settings (everything but the entries) and saves the manifest. */
  setGlossarySettings: (patch: Partial<Omit<GlossarySettings, "entries">>) => Promise<void>;
  /**
   * Puts an index entry on every whole-word match of `query` in the book that is not marked with this entry yet (case does not
   * matter). One book undo step. Returns how many places were marked.
   */
  markIndexOccurrences: (
    entry: { term: string; sub?: string; see?: string; seeAlso?: string },
    query: string,
  ) => Promise<number>;
  /** Renames a term in every mark that carries it, and the cross-references that name it. Naming an existing term merges them. One undo step. */
  renameIndexTerm: (from: string, to: string) => Promise<number>;
  /** Puts a term under another term as a subentry. One undo step. */
  moveIndexTerm: (term: string, under: string) => Promise<number>;
  /** Takes a term and all its places out of the index; the words stay. One undo step. */
  deleteIndexTerm: (term: string) => Promise<number>;
  /** Takes one place out of the index; the words stay. One undo step. */
  removeIndexPlace: (id: string) => Promise<number>;
  /** Leaves a term out of the exported index (it stays in the pages), or lists it again. */
  setIndexTermHidden: (term: string, hidden: boolean) => Promise<void>;
  /** Adds an entry to the glossary and returns its id, or null when it was refused (a problem was shown). */
  addGlossaryEntry: (entry: Omit<GlossaryEntry, "id">) => Promise<string | null>;
  /** Changes an entry; the marks name it by id so they follow. Returns false when it was refused. */
  updateGlossaryEntry: (id: string, patch: Partial<Omit<GlossaryEntry, "id">>) => Promise<boolean>;
  /** Removes an entry and every use of it in the pages (the words stay). Not undoable. */
  removeGlossaryEntry: (id: string) => Promise<void>;
  /**
   * Marks the words of an entry (its term and its aliases) in the book: every match, or with `firstOnly` the first in each page.
   * Text already marked with this entry is left alone. One book undo step. Returns how many uses were marked.
   */
  markGlossaryOccurrences: (id: string, firstOnly: boolean) => Promise<number>;
}
