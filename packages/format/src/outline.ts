import type { ChapterDoc, DocNode } from "@cadabracraft/shared";

export interface OutlineItem {
  /** Position among all headings of the chapter in document order, empty ones included. The editor jumps by this number. */
  index: number;
  /** 1 to 3 (the schema allows nothing else). */
  level: number;
  text: string;
}

/** The plain text of a node: text nodes joined, a line break as a space. */
function textOf(node: DocNode): string {
  if (node.type === "text") return node.text;
  if (node.type === "hardBreak") return " ";
  return (node.content ?? []).map(textOf).join("");
}

/**
 * The headings of a chapter in reading order, for the outline navigator. Headings without any text are numbered (so `index`
 * still matches the editor's Nth heading) but left out of the list. Whitespace inside a heading is collapsed.
 */
export function extractOutline(doc: ChapterDoc | null): OutlineItem[] {
  const items: OutlineItem[] = [];
  let index = 0;
  const walk = (nodes: readonly DocNode[]) => {
    for (const node of nodes) {
      if (node.type === "text") continue;
      if (node.type === "heading") {
        const text = textOf(node).replace(/\s+/g, " ").trim();
        const level = Number(node.attrs?.level);
        if (text) items.push({ index, level: level >= 1 && level <= 3 ? level : 1, text });
        index++;
      }
      walk(node.content ?? []);
    }
  };
  walk(doc?.content ?? []);
  return items;
}
