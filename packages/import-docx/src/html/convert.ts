import type { DocNode, Mark } from "@cadabracraft/shared";
import {
  cellParagraphs,
  flattenItems,
  definitionNodes,
  imageItems,
  isSep,
  listNodes,
  cleanText,
  paragraphOf,
  safeHref,
  tableOf,
  textNode,
  type DefinitionEntry,
  type ListEntry,
} from "../common";
import { ImportError } from "../types";
import { MAX_DOM_DEPTH, guarded, refuseHostileShape } from "./guards";
import {
  CONTAINERS,
  MARK_TAGS,
  PLAIN_INLINE,
  SKIP,
  attr,
  collapse,
  hasClass,
  isElement,
  isText,
  parseSnippet,
  preText,
  textOf,
  withMark,
  type HtmlCtx,
  type PElement,
  type PNode,
} from "./dom";
import { flush, newFlow, trimRun, type Flow } from "./run";

// The helpers below moved to ./dom; they are re-exported so importers of this module are unaffected.
export {
  documentTitle,
  isElement,
  newCtx,
  parseSnippet,
  type HtmlCtx,
  type PElement,
  type PNode,
  type PText,
} from "./dom";

function blocksIn(
  nodes: readonly PNode[],
  ctx: HtmlCtx,
  marks: Mark[],
  depth: number,
  dom: number,
): DocNode[] {
  const f = newFlow();
  flow(nodes, ctx, marks, f, depth, dom);
  flush(f, ctx);
  return f.out;
}

function flow(
  nodes: readonly PNode[],
  ctx: HtmlCtx,
  marks: Mark[],
  f: Flow,
  depth: number,
  dom: number,
): void {
  if (dom > MAX_DOM_DEPTH)
    throw new ImportError("too-deeply-nested", "The HTML is nested too deeply to import.");
  for (const n of nodes) {
    if (isText(n)) {
      const t = textNode(collapse(n.value), marks);
      if (t) f.run.push(t);
    } else if (isElement(n)) element(n, ctx, marks, f, depth, dom + 1);
  }
}

function element(
  el: PElement,
  ctx: HtmlCtx,
  marks: Mark[],
  f: Flow,
  depth: number,
  dom: number,
): void {
  const tag = el.tagName;
  if (SKIP.has(tag)) return;
  const mark = MARK_TAGS[tag];
  if (mark) return flow(el.childNodes, ctx, withMark(marks, mark), f, depth, dom);
  if (/^h[1-6]$/.test(tag)) return heading(el, ctx, marks, f, depth, dom);
  switch (tag) {
    case "p":
      flush(f, ctx);
      flow(el.childNodes, ctx, marks, f, depth, dom);
      flush(f, ctx);
      return;
    case "br":
      f.run.push({ sep: "break" });
      return;
    case "hr":
      flush(f, ctx);
      f.out.push({ type: "sceneBreak" });
      return;
    case "img":
      f.run.push(
        ...imageItems(
          attr(el, "src") ?? "",
          collapse(attr(el, "alt") ?? "").trim(),
          attr(el, "title"),
          undefined,
          ctx,
        ),
      );
      return;
    case "a": {
      const href = attr(el, "href");
      if (href === undefined || href.trim().startsWith("#"))
        return flow(el.childNodes, ctx, marks, f, depth, dom);
      const safe = safeHref(href);
      if (safe)
        return flow(
          el.childNodes,
          ctx,
          [...marks, { type: "link", attrs: { href: safe } }],
          f,
          depth,
          dom,
        );
      ctx.warn.at(
        "unsafe-link",
        "warning",
        `Link removed (only http, https and mailto are kept): ${href.slice(0, 80)}`,
      );
      return flow(el.childNodes, ctx, marks, f, depth, dom);
    }
    case "span": {
      if (hasClass(el, "footnote")) {
        const text = textOf(el);
        f.run.push(
          text
            ? { type: "footnote", content: [{ type: "text", text: cleanText(text) }] }
            : { type: "footnote" },
        );
        return;
      }
      const small =
        hasClass(el, "small-caps") ||
        /font-variant(?:-caps)?\s*:\s*(?:all-)?small-caps/i.test(attr(el, "style") ?? "");
      return flow(
        el.childNodes,
        ctx,
        small ? [...marks, { type: "smallCaps" }] : marks,
        f,
        depth,
        dom,
      );
    }
    case "blockquote": {
      flush(f, ctx);
      if (depth >= ctx.maxDepth) return tooDeep(el, ctx, f);
      const inner = blocksIn(el.childNodes, ctx, marks, depth + 1, dom);
      f.out.push({ type: "blockquote", content: inner.length ? inner : [{ type: "paragraph" }] });
      return;
    }
    case "ul":
    case "ol":
      flush(f, ctx);
      if (depth >= ctx.maxDepth) return tooDeep(el, ctx, f);
      return list(el, ctx, marks, f, depth, dom);
    case "pre": {
      flush(f, ctx);
      const code = el.childNodes.find((c): c is PElement => isElement(c) && c.tagName === "code");
      const lang = /(?:^|\s)(?:language|lang)-([A-Za-z0-9_+#.-]{1,32})(?:\s|$)/.exec(
        attr(code ?? el, "class") ?? "",
      )?.[1];
      const text = cleanText(preText(el));
      f.out.push({
        type: "codeBlock",
        ...(lang ? { attrs: { language: lang } } : {}),
        ...(text ? { content: [{ type: "text", text }] } : {}),
      });
      return;
    }
    case "table":
      flush(f, ctx);
      return table(el, ctx, marks, f, depth, dom);
    case "dl":
      flush(f, ctx);
      if (depth >= ctx.maxDepth) return tooDeep(el, ctx, f);
      return definitions(el, ctx, marks, f, depth, dom);
    case "input":
      // A checkbox is read as the state of its task item (see `checkboxOf`); one anywhere else carries no text.
      if (attr(el, "type")?.toLowerCase() === "checkbox") return;
      break;
  }
  if (CONTAINERS.has(tag)) {
    flush(f, ctx);
    flow(el.childNodes, ctx, marks, f, depth, dom);
    flush(f, ctx);
    return;
  }
  if (!PLAIN_INLINE.has(tag))
    ctx.warn.tally(
      "unsupported-element",
      "warning",
      "Unsupported HTML elements were ignored; their text was kept.",
      `<${tag}>`,
    );
  flow(el.childNodes, ctx, marks, f, depth, dom);
}

function tooDeep(el: PElement, ctx: HtmlCtx, f: Flow): void {
  ctx.warn.at(
    "nesting-too-deep",
    "warning",
    `Nesting deeper than ${ctx.maxDepth} levels was flattened to text.`,
  );
  const t = textNode(textOf(el));
  if (t) f.out.push(paragraphOf([t]));
}

function heading(
  el: PElement,
  ctx: HtmlCtx,
  marks: Mark[],
  f: Flow,
  depth: number,
  dom: number,
): void {
  flush(f, ctx);
  let level = Number(el.tagName[1]);
  if (level > 3) {
    ctx.warn.at("heading-clamped", "warning", `Heading level ${level} was changed to level 3.`);
    level = 3;
  }
  const inner = newFlow();
  flow(el.childNodes, ctx, marks, inner, depth, dom);
  const items = trimRun(inner.run);
  const content = flattenItems(items);
  f.out.push(
    content.length
      ? { type: "heading", attrs: { level }, content }
      : { type: "heading", attrs: { level } },
  );
  for (const i of items) if (isSep(i) && i.sep === "block") f.out.push(i.node);
  f.out.push(...inner.out);
}

/** The checkbox that makes a list item a task item: an `<input type=checkbox>` first in the item, alone or inside a `<label>`. */
function checkboxOf(li: PElement): boolean | null {
  for (const c of li.childNodes) {
    if (isText(c) && c.value.trim() === "") continue;
    if (!isElement(c)) return null;
    const input =
      c.tagName === "input"
        ? c
        : c.tagName === "label"
          ? c.childNodes.find((k): k is PElement => isElement(k) && k.tagName === "input")
          : undefined;
    if (!input || attr(input, "type")?.toLowerCase() !== "checkbox") return null;
    return attr(input, "checked") !== undefined || attr(li, "data-checked") === "true";
  }
  return null;
}

function list(
  el: PElement,
  ctx: HtmlCtx,
  marks: Mark[],
  f: Flow,
  depth: number,
  dom: number,
): void {
  const items: ListEntry[] = [];
  let loose: Flow | null = null;
  const endLoose = () => {
    if (!loose) return;
    flush(loose, ctx);
    if (loose.out.length) items.push({ content: loose.out, checked: null });
    loose = null;
  };
  for (const c of el.childNodes) {
    if (isElement(c) && c.tagName === "li") {
      endLoose();
      items.push({
        content: blocksIn(c.childNodes, ctx, marks, depth + 1, dom + 1),
        checked: checkboxOf(c),
      });
    } else if (isText(c) && c.value.trim() === "") continue;
    else {
      // Stray content directly inside the list: keep it as an item of its own.
      loose ??= newFlow();
      flow([c], ctx, marks, loose, depth + 1, dom + 1);
    }
  }
  endLoose();
  if (items.length === 0) return;
  const start = Number.parseInt(attr(el, "start") ?? "", 10);
  const { nodes, numberedTasks } = listNodes(
    items,
    el.tagName === "ol",
    Number.isInteger(start) && start >= 0 && start <= 999_999 ? start : 1,
  );
  if (numberedTasks)
    ctx.warn.at(
      "task-list",
      "info",
      "Task items in a numbered list lost their numbers; task lists are not numbered.",
    );
  f.out.push(...nodes);
}

/** `<dl>`: `<dt>` terms and `<dd>` descriptions, directly or inside `<div>` groups. */
function definitions(
  el: PElement,
  ctx: HtmlCtx,
  marks: Mark[],
  f: Flow,
  depth: number,
  dom: number,
): void {
  const entries: DefinitionEntry[] = [];
  const walkDl = (nodes: readonly PNode[], level: number) => {
    for (const c of nodes) {
      if (!isElement(c)) continue;
      if (c.tagName === "dt") {
        const inner = newFlow();
        flow(c.childNodes, ctx, marks, inner, depth + 1, dom + 1);
        const items = trimRun(inner.run);
        entries.push({ kind: "term", content: flattenItems(items) });
        // Block-level content inside a term (an image, a list) cannot live in a term: it follows as the term's description.
        const extra: DocNode[] = [];
        for (const i of items) if (isSep(i) && i.sep === "block") extra.push(i.node);
        extra.push(...inner.out);
        if (extra.length) entries.push({ kind: "desc", content: extra });
      } else if (c.tagName === "dd")
        entries.push({
          kind: "desc",
          content: blocksIn(c.childNodes, ctx, marks, depth + 1, dom + 1),
        });
      else if (c.tagName === "div" && level < 2) walkDl(c.childNodes, level + 1);
    }
  };
  walkDl(el.childNodes, 0);
  f.out.push(...definitionNodes(entries));
}

function table(
  el: PElement,
  ctx: HtmlCtx,
  marks: Mark[],
  f: Flow,
  depth: number,
  dom: number,
): void {
  const rows: { tr: PElement; head: boolean }[] = [];
  for (const c of el.childNodes) {
    if (!isElement(c)) continue;
    // parse5 wraps loose rows in an implied <tbody>, so a <tr> is never a direct child of <table>.
    if (c.tagName === "thead" || c.tagName === "tbody" || c.tagName === "tfoot") {
      for (const r of c.childNodes)
        if (isElement(r) && r.tagName === "tr") rows.push({ tr: r, head: c.tagName === "thead" });
    } else if (c.tagName === "caption")
      f.out.push(...blocksIn(c.childNodes, ctx, marks, depth, dom + 1));
  }
  let flattened = false;
  let merged = false;
  const cellEls = rows.map(({ tr }) =>
    tr.childNodes.filter(
      (c): c is PElement => isElement(c) && (c.tagName === "td" || c.tagName === "th"),
    ),
  );
  const cells = cellEls.map((row) =>
    row.map((cell) => {
      if (
        (Number.parseInt(attr(cell, "colspan") ?? "", 10) || 1) > 1 ||
        (Number.parseInt(attr(cell, "rowspan") ?? "", 10) || 1) > 1
      )
        merged = true;
      const r = cellParagraphs(blocksIn(cell.childNodes, ctx, marks, depth + 1, dom + 2));
      flattened ||= r.flattened;
      return r.paragraphs;
    }),
  );
  const first = rows[0];
  const headerRow =
    !!first &&
    (first.head || (cellEls[0]!.length > 0 && cellEls[0]!.every((c) => c.tagName === "th")));
  const { node, padded } = tableOf(cells, headerRow);
  if (flattened)
    ctx.warn.at(
      "table-complex",
      "warning",
      "Lists, images and nested tables inside table cells were flattened to paragraphs.",
    );
  if (merged || padded)
    ctx.warn.at(
      "table-merged",
      "warning",
      "Merged or missing table cells were replaced by empty cells so the table stays rectangular.",
    );
  if (node) f.out.push(node);
}

/** Convert parsed nodes into top-level blocks. */
export const convert = (nodes: readonly PNode[], ctx: HtmlCtx): DocNode[] =>
  guarded(() => blocksIn(nodes, ctx, [], 0, 0));

/** Blocks for an HTML snippet, sharing the caller's warnings and asset registry (used by the Markdown importer). */
export function htmlSnippetBlocks(html: string, ctx: HtmlCtx): DocNode[] {
  refuseHostileShape(html);
  return convert(
    guarded(() => parseSnippet(html)),
    ctx,
  );
}
