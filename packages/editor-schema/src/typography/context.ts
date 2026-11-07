import type { ResolvedPos } from "@tiptap/pm/model";

/** The only inline leaf is the hard break; it reads as a line break, so a quote after it opens. */
const leafText = "\n";

/** The character just before a position inside its text block ("" at the start of the block). */
export function charBefore($pos: ResolvedPos): string {
  const end = $pos.parentOffset;
  const text = $pos.parent.textBetween(Math.max(0, end - 2), end, undefined, leafText);
  return Array.from(text).pop() ?? "";
}

/** All the text of the block after a position. */
export const textAfter = ($pos: ResolvedPos): string =>
  $pos.parent.textBetween($pos.parentOffset, $pos.parent.content.size, undefined, leafText);

/** The language of the `lang` mark at a position, or undefined when the text there is in the book's language. */
export function langMarkAt($pos: ResolvedPos): string | undefined {
  const mark = $pos.marks().find((m) => m.type.name === "lang");
  return mark ? (mark.attrs.lang as string) : undefined;
}
