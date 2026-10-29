/**
 * Word starts of a text block, shared by the PDF exporter (which marks them in the Typst source) and the editor (which maps a mark back
 * to a ProseMirror position), so both count words the same way.
 *
 * A text block is a list of inline items: a string for a run of text, `null` for any other one-position inline leaf (a hard break), and
 * a number n for an inline node that takes n positions and is no part of any word (a footnote and its text: the word around it goes on).
 * Offsets are flat positions inside the block's content, the way ProseMirror counts them: UTF-16 code units for text, 1 for a leaf.
 * A word starts at the first character that is not a space or tab after a space, a tab, a leaf or the start of the block. Other
 * characters (line feeds, no-break spaces, punctuation) belong to a word.
 */
export function wordStarts(items: readonly (string | number | null)[]): number[] {
  const out: number[] = [];
  let offset = 0;
  let boundary = true;
  for (const item of items) {
    if (typeof item === "number") {
      offset += item;
      continue;
    }
    if (item === null) {
      offset += 1;
      boundary = true;
      continue;
    }
    for (let i = 0; i < item.length; i++) {
      const c = item[i]!;
      if (c === " " || c === "\t") boundary = true;
      else if (boundary) {
        out.push(offset + i);
        boundary = false;
      }
    }
    offset += item.length;
  }
  return out;
}
