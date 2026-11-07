import type { Template } from "./types";

/** A book or chapter's own choice: `true` or `false`, or absent to follow what is above it. */
export interface DropCapChoice {
  dropCap?: boolean;
}

/**
 * Whether a chapter opens with a big first letter: the chapter's own choice, else the book's, else the template's.
 * Pass the manifest and the chapter's entry; `{}` stands for a level that has no choice to give.
 */
export const resolveDropCap = (
  template: Pick<Template, "print">,
  book: DropCapChoice,
  entry: DropCapChoice,
): boolean => entry.dropCap ?? book.dropCap ?? template.print.chapterOpening.dropCap;
