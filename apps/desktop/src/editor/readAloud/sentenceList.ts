import type { Node as PMNode } from "@tiptap/pm/model";
import { splitSentences } from "./sentences";

/** One sentence of the chapter: the document range it covers, its text, and whether it ends its paragraph or heading. */
export interface ReadSentence {
  from: number;
  to: number;
  text: string;
  endsBlock: boolean;
}

/**
 * The sentences of every text block in document order (headings, paragraphs, table cells). Text offsets are mapped back to
 * document positions, so the highlight covers exactly the words read. Inline nodes (footnote references, line breaks) add no text.
 */
export function readSentences(doc: PMNode): ReadSentence[] {
  const out: ReadSentence[] = [];
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return;
    let text = "";
    const at: number[] = [];
    node.forEach((child, offset) => {
      if (!child.isText || !child.text) return;
      for (let i = 0; i < child.text.length; i++) {
        text += child.text[i];
        at.push(pos + 1 + offset + i);
      }
    });
    const spans = splitSentences(text);
    spans.forEach((s, k) =>
      out.push({
        from: at[s.start]!,
        to: at[s.end - 1]! + 1,
        text: text.slice(s.start, s.end),
        endsBlock: k === spans.length - 1,
      }),
    );
    return false;
  });
  return out;
}
