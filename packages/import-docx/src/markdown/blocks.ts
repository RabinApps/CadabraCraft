import type { DocNode } from "@cadabracraft/shared";
import type { Nodes, RootContent } from "mdast";
import {
  type Item,
  cellParagraphs,
  cleanText,
  definitionNodes,
  flattenItems,
  isSep,
  alignFrom,
  alignOfCss,
  listNodes,
  paragraphOf,
  tableOf,
} from "../common";
import { groupDefinitions, type DefEntry } from "./definitions";
import { htmlSnippetBlocks } from "../html";
import { inlines, lineOf, toText, type Ctx } from "./marks";

/** Turn inline items into blocks: paragraphs separated at breaks, images as their own blocks. */
function paragraphs(items: Item[], ctx: Ctx, line: number | undefined): DocNode[] {
  const out: DocNode[] = [];
  let cur: DocNode[] = [];
  const flush = () => {
    const p = paragraphOf(cur);
    if (p.type === "paragraph" && p.content) out.push(p);
    cur = [];
  };
  let breaks = false;
  for (const it of items) {
    if (!isSep(it)) cur.push(it);
    else if (it.sep === "break") {
      breaks = true;
      flush();
    } else {
      flush();
      out.push(it.node);
    }
  }
  flush();
  if (breaks)
    ctx.warn.at(
      "line-break",
      "info",
      "Hard line breaks split the paragraph into separate paragraphs.",
      line,
    );
  return out;
}

/** A definition group as blocks: terms are inline text (images in a term are dropped, with a warning), descriptions are blocks. */
function definitionBlocks(entries: DefEntry[], ctx: Ctx, line: number | undefined): DocNode[] {
  return definitionNodes(
    entries.map((e) => {
      const items = inlines(e.nodes, ctx, []);
      if (e.kind === "desc") return { kind: "desc", content: paragraphs(items, ctx, line) };
      if (items.some((i) => isSep(i) && i.sep === "block"))
        ctx.warn.at(
          "definition-term-image",
          "warning",
          "Images inside a definition term were dropped.",
          line,
        );
      return { kind: "term", content: flattenItems(items) };
    }),
  );
}

/**
 * The wrapper `export-markdown` writes (with `htmlMarks`) around an aligned paragraph or heading: `<div align="center">`, then the
 * Markdown after a blank line, then `</div>`. Both tags are blocks of their own, so what lies between them is read as Markdown.
 */
const ALIGN_OPEN = /^<div align="(left|center|right)">\s*$/;
const ALIGN_CLOSE = /^<\/div>\s*$/;

type Heading = Extract<RootContent, { type: "heading" }>;
type ListNode = Extract<RootContent, { type: "list" }>;
type CodeNode = Extract<RootContent, { type: "code" }>;
type TableNode = Extract<RootContent, { type: "table" }>;

function headingBlocks(n: Heading, ctx: Ctx, line: number | undefined): DocNode[] {
  let level = n.depth;
  if (level > 3) {
    ctx.warn.at(
      "heading-clamped",
      "warning",
      `Heading level ${level} was changed to level 3.`,
      line,
    );
    level = 3;
  }
  const items = inlines(n.children, ctx, []);
  const flat = flattenItems(items);
  const out: DocNode[] = [
    flat.length
      ? { type: "heading", attrs: { level }, content: flat }
      : { type: "heading", attrs: { level } },
  ];
  for (const i of items) if (isSep(i) && i.sep === "block") out.push(i.node);
  return out;
}

function listBlocks(n: ListNode, ctx: Ctx, depth: number, line: number | undefined): DocNode[] {
  const entries = n.children.map((li) => ({
    content: blocks(li.children, ctx, depth + 1),
    checked: li.checked ?? null,
  }));
  const { nodes: lists, numberedTasks } = listNodes(entries, !!n.ordered, n.start ?? 1);
  if (numberedTasks)
    ctx.warn.at(
      "task-list",
      "info",
      "Task items in a numbered list lost their numbers; task lists are not numbered.",
      line,
    );
  return lists;
}

function codeBlocks(n: CodeNode): DocNode[] {
  const lang = /^[A-Za-z0-9_+#.-]{1,32}$/.test(n.lang ?? "") ? n.lang : undefined;
  return [
    {
      type: "codeBlock",
      ...(lang ? { attrs: { language: lang } } : {}),
      ...(cleanText(n.value) ? { content: [{ type: "text", text: cleanText(n.value) }] } : {}),
    },
  ];
}

function tableBlocks(n: TableNode, ctx: Ctx, line: number | undefined): DocNode[] {
  // GFM: the first row is the header.
  let flattened = false;
  const rows = n.children.map((row) =>
    row.children.map((cell) => {
      const r = cellParagraphs(paragraphs(inlines(cell.children, ctx, []), ctx, line));
      flattened ||= r.flattened;
      return r.paragraphs;
    }),
  );
  if (flattened)
    ctx.warn.at(
      "table-complex",
      "warning",
      "Images inside table cells were replaced by their alt text.",
      line,
    );
  const { node } = tableOf(rows, true);
  return node ? [node] : [];
}

/** A list or quote nested deeper than the limit is flattened to one paragraph per line of its text. */
function flattenedBlocks(n: RootContent, ctx: Ctx, line: number | undefined): DocNode[] {
  ctx.warn.at(
    "nesting-too-deep",
    "warning",
    `Nesting deeper than ${ctx.maxDepth} levels was flattened to text.`,
    line,
  );
  const out: DocNode[] = [];
  for (const l of toText(n).split("\n"))
    if (l.trim()) out.push(paragraphOf([{ type: "text", text: l.trim() }]));
  return out;
}

function unsupportedBlocks(n: RootContent, ctx: Ctx, line: number | undefined): DocNode[] {
  ctx.warn.at(
    "unsupported-node",
    "warning",
    `Unsupported element "${(n as { type: string }).type}" was kept as text.`,
    line,
  );
  const t = toText(n as Nodes).trim();
  return t ? [paragraphOf([{ type: "text", text: t }])] : [];
}

/** The blocks one Markdown node becomes (an HTML node is handled by `blocks`, which tracks the alignment wrappers). */
function nodeBlocks(n: RootContent, ctx: Ctx, depth: number, line: number | undefined): DocNode[] {
  switch (n.type) {
    case "heading":
      return headingBlocks(n, ctx, line);
    case "paragraph":
      return paragraphs(inlines(n.children, ctx, []), ctx, line);
    case "blockquote": {
      const inner = blocks(n.children, ctx, depth + 1);
      return [{ type: "blockquote", content: inner.length ? inner : [{ type: "paragraph" }] }];
    }
    case "list":
      return listBlocks(n, ctx, depth, line);
    case "thematicBreak":
      return [{ type: "sceneBreak" }];
    case "code":
      return codeBlocks(n);
    case "table":
      return tableBlocks(n, ctx, line);
    case "definition":
    case "footnoteDefinition":
    case "yaml":
      return [];
    default:
      return unsupportedBlocks(n, ctx, line);
  }
}

export function blocks(nodes: RootContent[], ctx: Ctx, depth: number): DocNode[] {
  const out: DocNode[] = [];
  let scope: { from: number; align: ReturnType<typeof alignOfCss> } | null = null;
  const closeScope = () => {
    if (scope) alignFrom(out, scope.from, scope.align);
    scope = null;
  };
  for (const n of groupDefinitions(nodes, ctx.source ?? "")) {
    if (n.type === "defGroup") {
      out.push(...definitionBlocks(n.entries, ctx, n.position?.start.line));
      continue;
    }
    const line = lineOf(n);
    if (depth > ctx.maxDepth && (n.type === "list" || n.type === "blockquote")) {
      out.push(...flattenedBlocks(n, ctx, line));
    } else if (n.type === "html") {
      const open = ALIGN_OPEN.exec(n.value);
      if (open) {
        closeScope();
        scope = { from: out.length, align: alignOfCss(open[1]) };
      } else if (scope && ALIGN_CLOSE.test(n.value)) closeScope();
      else out.push(...htmlSnippetBlocks(n.value, ctx));
    } else out.push(...nodeBlocks(n, ctx, depth, line));
  }
  // A wrapper that is never closed holds the rest of the document.
  closeScope();
  return out;
}
