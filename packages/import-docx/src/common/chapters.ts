import type { ChapterDoc, DocNode } from "@cadabracraft/shared";
import type { ImportedChapter, ImportOptions } from "../types";
import type { Warnings } from "./warnings";
import { paragraphOf, plainText } from "./text";

/**
 * Splits top-level blocks into chapters on headings of the split level. The heading stays in the chapter doc
 * (matches fixtures/manuscripts). Content before the first heading becomes an "Untitled" chapter.
 */
export function splitChapters(blocks: DocNode[], opts: ImportOptions, warn: Warnings): ImportedChapter[] {
  const level = opts.splitHeadingLevel ?? 1;
  const untitled = opts.untitledTitle ?? "Untitled";
  const chapters: { title: string; content: DocNode[]; pre: boolean }[] = [];
  let cur: { title: string; content: DocNode[]; pre: boolean } | null = null;
  let sawHeading = false;
  for (const b of blocks) {
    if (b.type === "heading" && b.attrs?.level === level) {
      sawHeading = true;
      cur = { title: plainText(b.content).trim() || untitled, content: [b], pre: false };
      chapters.push(cur);
      continue;
    }
    if (!cur) {
      cur = { title: untitled, content: [], pre: true };
      chapters.push(cur);
    }
    cur.content.push(b);
  }
  if (chapters.length === 0) {
    warn.at("empty-input", "warning", "The file contains no importable content.");
  } else if (!sawHeading) {
    warn.at("no-headings", "warning", `No level ${level} headings found, so the whole file is one chapter titled "${untitled}".`);
  } else if (chapters[0]!.pre) {
    warn.at("untitled-content", "warning", `Content before the first level ${level} heading was placed in a chapter titled "${untitled}".`);
  }
  return chapters.map((c) => ({ title: c.title, doc: { type: "doc", content: c.content } as ChapterDoc }));
}

/** Fix a list item's content to satisfy `paragraph block*`. */
export function listItemOf(content: DocNode[]): DocNode {
  const c = content.length && content[0]!.type === "paragraph" ? content : [{ type: "paragraph" } as DocNode, ...content];
  return { type: "listItem", content: c };
}

/** A table cell must hold `paragraph+`: keep paragraphs, flatten any other block to paragraphs, and say whether that changed anything. */
export function cellParagraphs(blocks: DocNode[]): { paragraphs: DocNode[]; flattened: boolean } {
  const paragraphs: DocNode[] = [];
  let flattened = false;
  const kids = (n: DocNode): DocNode[] => ("content" in n ? n.content ?? [] : []);
  const rowText = (row: DocNode): string => kids(row).map((c) => plainText(kids(c).flatMap(kids)).replace(/\s+/g, " ").trim()).join(" | ");
  const walk = (n: DocNode) => {
    switch (n.type) {
      case "paragraph": paragraphs.push(n); break;
      case "heading": flattened = true; paragraphs.push(paragraphOf(n.content ?? [])); break;
      case "bulletList": case "orderedList": case "blockquote": case "listItem": flattened = true; for (const k of n.content ?? []) walk(k); break;
      case "table": {
        flattened = true;
        for (const row of n.content ?? []) {
          const t = rowText(row);
          if (t.replace(/[|\s]/g, "")) paragraphs.push(paragraphOf([{ type: "text", text: t }]));
        }
        break;
      }
      case "codeBlock": flattened = true; if (plainText(n.content)) paragraphs.push(paragraphOf([{ type: "text", text: plainText(n.content) }])); break;
      case "image": flattened = true; if (n.attrs?.alt) paragraphs.push(paragraphOf([{ type: "text", text: String(n.attrs.alt) }])); break;
      default: flattened = true;
    }
  };
  for (const b of blocks) walk(b);
  return { paragraphs: paragraphs.length ? paragraphs : [{ type: "paragraph" }], flattened };
}

/** A rectangular table node from rows of cells (each cell a paragraph list); short rows are padded with empty cells. `null` when there are no cells. */
export function tableOf(rows: DocNode[][][], headerRow: boolean): { node: DocNode | null; padded: boolean } {
  const width = Math.max(0, ...rows.map((r) => r.length));
  if (width === 0) return { node: null, padded: false };
  let padded = false;
  const kept = rows.filter((r) => r.length > 0);
  const content = kept.map((cells, i) => {
    if (cells.length < width) padded = true;
    const full = [...cells, ...Array.from({ length: width - cells.length }, () => [{ type: "paragraph" } as DocNode])];
    return { type: "tableRow", content: full.map((c) => ({ type: headerRow && i === 0 ? "tableHeader" : "tableCell", content: c }) as DocNode) } as DocNode;
  });
  return { node: { type: "table", content }, padded };
}
