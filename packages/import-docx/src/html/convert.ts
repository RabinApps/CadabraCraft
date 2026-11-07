import { isLangTag, type DocNode, type Mark } from "@cadabracraft/shared";
import {
  cellParagraphs,
  flattenItems,
  definitionNodes,
  imageItems,
  isSep,
  listNodes,
  cleanText,
  alignFrom,
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
  alignOf,
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
import { checkboxOf, tooDeep } from "./leaf";

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

/** Where a node sits: the shared context, the marks in force, how many lists and quotes deep (`depth`) and how many elements deep (`dom`). */
interface Scope {
  ctx: HtmlCtx;
  marks: Mark[];
  depth: number;
  dom: number;
}

/** The scope `levels` lists/quotes and `elements` DOM levels further in. */
const deeper = (s: Scope, levels: number, elements: number): Scope => ({
  ...s,
  depth: s.depth + levels,
  dom: s.dom + elements,
});

const marked = (s: Scope, marks: Mark[]): Scope => ({ ...s, marks });

function blocksIn(nodes: readonly PNode[], s: Scope): DocNode[] {
  const f = newFlow();
  flow(nodes, s, f);
  flush(f, s.ctx);
  return f.out;
}

function flow(nodes: readonly PNode[], s: Scope, f: Flow): void {
  if (s.dom > MAX_DOM_DEPTH)
    throw new ImportError("too-deeply-nested", "The HTML is nested too deeply to import.");
  for (const n of nodes) {
    if (isText(n)) {
      const t = textNode(collapse(n.value), s.marks);
      if (t) f.run.push(t);
    } else if (isElement(n)) element(n, deeper(s, 0, 1), f);
  }
}

/** Handles an element of one tag. `false` means "not mine after all": the element is then read as a container or inline element. */
type TagHandler = (el: PElement, s: Scope, f: Flow) => void | false;

/** A block that holds blocks: closes the text before it and gives the alignment it has to the blocks in it that have none. */
function container(el: PElement, s: Scope, f: Flow): void {
  flush(f, s.ctx);
  const from = f.out.length;
  flow(el.childNodes, s, f);
  flush(f, s.ctx);
  alignFrom(f.out, from, alignOf(el));
}

function link(el: PElement, s: Scope, f: Flow): void {
  const href = attr(el, "href");
  if (href === undefined || href.trim().startsWith("#")) return flow(el.childNodes, s, f);
  const safe = safeHref(href);
  if (safe)
    return flow(el.childNodes, marked(s, [...s.marks, { type: "link", attrs: { href: safe } }]), f);
  s.ctx.warn.at(
    "unsafe-link",
    "warning",
    `Link removed (only http, https and mailto are kept): ${href.slice(0, 80)}`,
  );
  return flow(el.childNodes, s, f);
}

function span(el: PElement, s: Scope, f: Flow): void {
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
  // A passage in another language (what the editor writes as span[lang] and the Markdown exporter as <span lang>).
  const lang = attr(el, "lang")?.trim();
  const spanMarks: Mark[] = [
    ...s.marks,
    ...(small ? [{ type: "smallCaps" } as const] : []),
    ...(isLangTag(lang) ? [{ type: "lang", attrs: { lang } } as const] : []),
  ];
  return flow(el.childNodes, marked(s, spanMarks), f);
}

function blockquote(el: PElement, s: Scope, f: Flow): void {
  flush(f, s.ctx);
  if (s.depth >= s.ctx.maxDepth) return tooDeep(el, s.ctx, f);
  const inner = blocksIn(el.childNodes, deeper(s, 1, 0));
  f.out.push({ type: "blockquote", content: inner.length ? inner : [{ type: "paragraph" }] });
}

function codeBlock(el: PElement, s: Scope, f: Flow): void {
  flush(f, s.ctx);
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
}

/** A block that cannot nest without limit (a list or a definition list): refuses past `maxDepth`. */
const nesting =
  (build: (el: PElement, s: Scope, f: Flow) => void): TagHandler =>
  (el, s, f) => {
    flush(f, s.ctx);
    if (s.depth >= s.ctx.maxDepth) return tooDeep(el, s.ctx, f);
    return build(el, s, f);
  };

const TAG_HANDLERS = new Map<string, TagHandler>([
  ["p", container],
  [
    "br",
    (_el, _s, f) => {
      f.run.push({ sep: "break" });
    },
  ],
  [
    "hr",
    (_el, s, f) => {
      flush(f, s.ctx);
      f.out.push({ type: "sceneBreak" });
    },
  ],
  [
    "img",
    (el, s, f) => {
      f.run.push(
        ...imageItems(
          attr(el, "src") ?? "",
          collapse(attr(el, "alt") ?? "").trim(),
          attr(el, "title"),
          undefined,
          s.ctx,
        ),
      );
    },
  ],
  ["a", link],
  ["span", span],
  ["blockquote", blockquote],
  ["ul", nesting(list)],
  ["ol", nesting(list)],
  ["pre", codeBlock],
  [
    "table",
    (el, s, f) => {
      flush(f, s.ctx);
      return table(el, s, f);
    },
  ],
  ["dl", nesting(definitions)],
  [
    "input",
    // A checkbox is read as the state of its task item (see `checkboxOf`); one anywhere else carries no text.
    (el) => (attr(el, "type")?.toLowerCase() === "checkbox" ? undefined : false),
  ],
]);

function element(el: PElement, s: Scope, f: Flow): void {
  const tag = el.tagName;
  if (SKIP.has(tag)) return;
  const mark = MARK_TAGS[tag];
  if (mark) return flow(el.childNodes, marked(s, withMark(s.marks, mark)), f);
  if (/^h[1-6]$/.test(tag)) return heading(el, s, f);
  const handler = TAG_HANDLERS.get(tag);
  if (handler && handler(el, s, f) !== false) return;
  if (CONTAINERS.has(tag)) return container(el, s, f);
  if (!PLAIN_INLINE.has(tag))
    s.ctx.warn.tally(
      "unsupported-element",
      "warning",
      "Unsupported HTML elements were ignored; their text was kept.",
      `<${tag}>`,
    );
  flow(el.childNodes, s, f);
}

function heading(el: PElement, s: Scope, f: Flow): void {
  flush(f, s.ctx);
  const from = f.out.length;
  let level = Number(el.tagName[1]);
  if (level > 3) {
    s.ctx.warn.at("heading-clamped", "warning", `Heading level ${level} was changed to level 3.`);
    level = 3;
  }
  const inner = newFlow();
  flow(el.childNodes, s, inner);
  const items = trimRun(inner.run);
  const content = flattenItems(items);
  f.out.push(
    content.length
      ? { type: "heading", attrs: { level }, content }
      : { type: "heading", attrs: { level } },
  );
  for (const i of items) if (isSep(i) && i.sep === "block") f.out.push(i.node);
  f.out.push(...inner.out);
  alignFrom(f.out, from, alignOf(el));
}

function list(el: PElement, s: Scope, f: Flow): void {
  const { ctx } = s;
  const inside = deeper(s, 1, 1);
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
      items.push({ content: blocksIn(c.childNodes, inside), checked: checkboxOf(c) });
    } else if (isText(c) && c.value.trim() === "") continue;
    else {
      // Stray content directly inside the list: keep it as an item of its own.
      loose ??= newFlow();
      flow([c], inside, loose);
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
function definitions(el: PElement, s: Scope, f: Flow): void {
  const inside = deeper(s, 1, 1);
  const entries: DefinitionEntry[] = [];
  const walkDl = (nodes: readonly PNode[], level: number) => {
    for (const c of nodes) {
      if (!isElement(c)) continue;
      if (c.tagName === "dt") {
        const inner = newFlow();
        flow(c.childNodes, inside, inner);
        const items = trimRun(inner.run);
        entries.push({ kind: "term", content: flattenItems(items) });
        // Block-level content inside a term (an image, a list) cannot live in a term: it follows as the term's description.
        const extra: DocNode[] = [];
        for (const i of items) if (isSep(i) && i.sep === "block") extra.push(i.node);
        extra.push(...inner.out);
        if (extra.length) entries.push({ kind: "desc", content: extra });
      } else if (c.tagName === "dd")
        entries.push({ kind: "desc", content: blocksIn(c.childNodes, inside) });
      else if (c.tagName === "div" && level < 2) walkDl(c.childNodes, level + 1);
    }
  };
  walkDl(el.childNodes, 0);
  f.out.push(...definitionNodes(entries));
}

function table(el: PElement, s: Scope, f: Flow): void {
  const { ctx } = s;
  const rows: { tr: PElement; head: boolean }[] = [];
  for (const c of el.childNodes) {
    if (!isElement(c)) continue;
    // parse5 wraps loose rows in an implied <tbody>, so a <tr> is never a direct child of <table>.
    if (c.tagName === "thead" || c.tagName === "tbody" || c.tagName === "tfoot") {
      for (const r of c.childNodes)
        if (isElement(r) && r.tagName === "tr") rows.push({ tr: r, head: c.tagName === "thead" });
    } else if (c.tagName === "caption") f.out.push(...blocksIn(c.childNodes, deeper(s, 0, 1)));
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
      const r = cellParagraphs(blocksIn(cell.childNodes, deeper(s, 1, 2)));
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
  guarded(() => blocksIn(nodes, { ctx, marks: [], depth: 0, dom: 0 }));

/** Blocks for an HTML snippet, sharing the caller's warnings and asset registry (used by the Markdown importer). */
export function htmlSnippetBlocks(html: string, ctx: HtmlCtx): DocNode[] {
  refuseHostileShape(html);
  return convert(
    guarded(() => parseSnippet(html)),
    ctx,
  );
}
