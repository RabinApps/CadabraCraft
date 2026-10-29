import type { Node as PMNode } from "@tiptap/pm/model";
import { wordStarts } from "@cadabracraft/shared";
import type { BlockMarkKind } from "@cadabracraft/export-pdf";

/**
 * The editor's side of Typst's page marks (see `lib/exactBreaks.ts`): what kind of block a top-level node is, by the exporter's
 * own rule (`BlockMarkKind`), and its words, counted by the same function the exporter marked them with (`wordStarts`).
 */

/** The inline items of a paragraph as `wordStarts` takes them, or null when it has anything but text and hard breaks (or code). */
export function plainItems(node: PMNode): (string | null)[] | null {
  const items: (string | null)[] = [];
  let ordinary = true;
  node.forEach((child) => {
    if (child.isText) {
      if (child.marks.some((m) => m.type.name === "code")) ordinary = false;
      items.push(child.text ?? "");
    } else if (child.type.name === "hardBreak") items.push(null);
    else ordinary = false;
  });
  return ordinary ? items : null;
}

export function blockKind(node: PMNode): BlockMarkKind {
  switch (node.type.name) {
    case "paragraph":
      return plainItems(node) ? "p" : "q";
    case "heading":
      return "h";
    case "sceneBreak":
      return "s";
    default:
      return "o";
  }
}

export const blockKinds = (doc: PMNode): BlockMarkKind[] => {
  const out: BlockMarkKind[] = [];
  doc.forEach((node) => out.push(blockKind(node)));
  return out;
};

/** Number of words of an ordinary paragraph (0 for anything else). */
export const wordCountOf = (node: PMNode): number => {
  const items = plainItems(node);
  return items ? wordStarts(items).length : 0;
};

/** The offset inside the paragraph's content (a document position is the paragraph's start + 1 + this) of word `word`, or null. */
export function wordOffset(node: PMNode, word: number): number | null {
  const items = plainItems(node);
  return (items && wordStarts(items)[word]) ?? null;
}
