import type { ChapterDoc, DocNode } from "@cadabracraft/shared";
import type { ImportedChapter, ImportOptions } from "../types";
import type { Warnings } from "./warnings";
import { paragraphOf, plainText } from "./text";

/**
 * Splits top-level blocks into chapters on headings of the split level. The heading stays in the chapter doc
 * (matches fixtures/manuscripts). Content before the first heading becomes an "Untitled" chapter.
 */
export function splitChapters(
  blocks: DocNode[],
  opts: ImportOptions,
  warn: Warnings,
): ImportedChapter[] {
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
    warn.at(
      "no-headings",
      "warning",
      `No level ${level} headings found, so the whole file is one chapter titled "${untitled}".`,
    );
  } else if (chapters[0]!.pre) {
    warn.at(
      "untitled-content",
      "warning",
      `Content before the first level ${level} heading was placed in a chapter titled "${untitled}".`,
    );
  }
  return chapters.map((c) => ({
    title: c.title,
    doc: { type: "doc", content: c.content } as ChapterDoc,
  }));
}

/** Fix a list item's content to satisfy `paragraph block*`. */
export function listItemOf(content: DocNode[]): DocNode {
  const c =
    content.length && content[0]!.type === "paragraph"
      ? content
      : [{ type: "paragraph" } as DocNode, ...content];
  return { type: "listItem", content: c };
}

const contentOf = (n: DocNode): DocNode[] => ("content" in n && n.content ? n.content : []);

/** A task item: like a list item (starts with a paragraph) with a checked flag. */
export function taskItemOf(content: DocNode[], checked: boolean): DocNode {
  return { type: "taskItem", attrs: { checked }, content: contentOf(listItemOf(content)) };
}

/** One list entry as read from a source: its blocks and, for a task item, whether it is checked (`null` for a plain item). */
export interface ListEntry {
  content: DocNode[];
  checked: boolean | null;
}

/**
 * The list nodes for a run of entries. Consecutive task items become a `taskList`; the plain items around them become
 * bullet or numbered lists, so a list that mixes both is split rather than losing the checkboxes. `numberedTasks` says a
 * task item came from a numbered list (task lists have no numbers).
 */
export function listNodes(
  entries: ListEntry[],
  ordered: boolean,
  start = 1,
): { nodes: DocNode[]; numberedTasks: boolean } {
  const nodes: DocNode[] = [];
  let numberedTasks = false;
  for (let i = 0; i < entries.length;) {
    const task = entries[i]!.checked !== null;
    let j = i;
    while (j < entries.length && (entries[j]!.checked !== null) === task) j++;
    const run = entries.slice(i, j);
    if (task) {
      numberedTasks ||= ordered;
      nodes.push({
        type: "taskList",
        content: run.map((e) => taskItemOf(e.content, e.checked === true)),
      });
    } else if (ordered) {
      const first = start + i;
      nodes.push({
        type: "orderedList",
        ...(first !== 1 ? { attrs: { start: first } } : {}),
        content: run.map((e) => listItemOf(e.content)),
      });
    } else nodes.push({ type: "bulletList", content: run.map((e) => listItemOf(e.content)) });
    i = j;
  }
  return { nodes, numberedTasks };
}

/** A term (inline content) or a description (blocks) read from a source, in order. */
export interface DefinitionEntry {
  kind: "term" | "desc";
  content: DocNode[];
}

/**
 * Blocks for a run of definition entries. The schema wants `(term+ description+)+`, so a description with no term before it
 * is kept as plain blocks in front of the list, and terms at the end that no description follows become paragraphs after it.
 */
export function definitionNodes(entries: DefinitionEntry[]): DocNode[] {
  const before: DocNode[] = [];
  const list: DocNode[] = [];
  for (const e of entries) {
    if (e.kind === "term")
      list.push({ type: "definitionTerm", ...(e.content.length ? { content: e.content } : {}) });
    else if (list.length === 0) before.push(...e.content);
    else list.push({ type: "definitionDescription", content: contentOf(listItemOf(e.content)) });
  }
  const after: DocNode[] = [];
  while (list.length && list[list.length - 1]!.type === "definitionTerm")
    after.unshift(paragraphOf(contentOf(list.pop()!)));
  return [
    ...before,
    ...(list.length ? [{ type: "definitionList", content: list } as DocNode] : []),
    ...after,
  ];
}

const kidsOf = (n: DocNode): DocNode[] => ("content" in n ? (n.content ?? []) : []);

/** One line of text per row of a table, the cells joined with " | ". */
function tableRowParagraphs(table: DocNode): DocNode[] {
  const rowText = (row: DocNode): string =>
    kidsOf(row)
      .map((c) => plainText(kidsOf(c).flatMap(kidsOf)).replace(/\s+/g, " ").trim())
      .join(" | ");
  const out: DocNode[] = [];
  for (const row of kidsOf(table)) {
    const t = rowText(row);
    if (t.replace(/[|\s]/g, "")) out.push(paragraphOf([{ type: "text", text: t }]));
  }
  return out;
}

/** Blocks that only hold other blocks: their children are read in place of them. */
const CONTAINER_BLOCKS = new Set([
  "bulletList",
  "orderedList",
  "taskList",
  "definitionList",
  "blockquote",
  "listItem",
  "taskItem",
  "definitionDescription",
]);

/** A table cell must hold `paragraph+`: keep paragraphs, flatten any other block to paragraphs, and say whether that changed anything. */
export function cellParagraphs(blocks: DocNode[]): { paragraphs: DocNode[]; flattened: boolean } {
  const paragraphs: DocNode[] = [];
  let flattened = false;
  const walk = (n: DocNode) => {
    if (n.type === "paragraph") {
      paragraphs.push(n);
      return;
    }
    flattened = true;
    if (n.type === "heading" || n.type === "definitionTerm")
      paragraphs.push(paragraphOf(kidsOf(n)));
    else if (CONTAINER_BLOCKS.has(n.type)) for (const k of kidsOf(n)) walk(k);
    else if (n.type === "table") paragraphs.push(...tableRowParagraphs(n));
    else if (n.type === "codeBlock") {
      if (plainText(kidsOf(n)))
        paragraphs.push(paragraphOf([{ type: "text", text: plainText(kidsOf(n)) }]));
    } else if (n.type === "image" && n.attrs?.alt)
      paragraphs.push(paragraphOf([{ type: "text", text: String(n.attrs.alt) }]));
  };
  for (const b of blocks) walk(b);
  return { paragraphs: paragraphs.length ? paragraphs : [{ type: "paragraph" }], flattened };
}

/** A rectangular table node from rows of cells (each cell a paragraph list); short rows are padded with empty cells. `null` when there are no cells. */
export function tableOf(
  rows: DocNode[][][],
  headerRow: boolean,
): { node: DocNode | null; padded: boolean } {
  const width = Math.max(0, ...rows.map((r) => r.length));
  if (width === 0) return { node: null, padded: false };
  let padded = false;
  const kept = rows.filter((r) => r.length > 0);
  const content = kept.map((cells, i) => {
    if (cells.length < width) padded = true;
    const full = [
      ...cells,
      ...Array.from({ length: width - cells.length }, () => [{ type: "paragraph" } as DocNode]),
    ];
    return {
      type: "tableRow",
      content: full.map(
        (c) =>
          ({ type: headerRow && i === 0 ? "tableHeader" : "tableCell", content: c }) as DocNode,
      ),
    } as DocNode;
  });
  return { node: { type: "table", content }, padded };
}
