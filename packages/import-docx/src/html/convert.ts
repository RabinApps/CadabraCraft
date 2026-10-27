import { parse, type DefaultTreeAdapterMap } from "parse5";
import type { DocNode, Mark } from "@cadabracraft/shared";
import {
  AssetRegistry,
  Warnings,
  type Item,
  cellParagraphs,
  flattenItems,
  imageItems,
  isSep,
  listItemOf,
  cleanText,
  paragraphOf,
  safeHref,
  tableOf,
  textNode,
} from "../common";
import { ImportError, type ImportOptions } from "../types";
import { MAX_DOM_DEPTH, guarded, refuseHostileShape } from "./guards";

export type PNode = DefaultTreeAdapterMap["node"];
export type PElement = DefaultTreeAdapterMap["element"];
export type PText = DefaultTreeAdapterMap["textNode"];

/** Dropped with their content. `head` is skipped here because the file importer reads `<title>` separately. */
const SKIP = new Set(["script", "style", "iframe", "object", "svg", "noscript", "template", "head", "title", "meta", "link", "base", "embed", "applet", "frame", "frameset", "col", "colgroup", "wbr", "select", "datalist"]);
/** Block containers with no formatting of their own: their children are laid out as if they were not there. */
const CONTAINERS = new Set([
  "html", "body", "div", "section", "article", "main", "header", "footer", "nav", "aside", "figure", "figcaption", "details", "summary",
  "center", "form", "fieldset", "legend", "address", "hgroup", "dl", "dt", "dd", "li", "tr", "td", "th", "thead", "tbody", "tfoot", "caption",
]);
/** Inline wrappers that carry nothing we keep and are not worth a warning. */
const PLAIN_INLINE = new Set(["span", "font", "abbr", "cite", "time", "label", "bdi", "bdo", "data"]);
const MARK_TAGS: Record<string, Mark> = {
  strong: { type: "bold" },
  b: { type: "bold" },
  em: { type: "italic" },
  i: { type: "italic" },
  u: { type: "underline" },
  s: { type: "strike" },
  del: { type: "strike" },
  strike: { type: "strike" },
  code: { type: "code" },
  sup: { type: "superscript" },
  sub: { type: "subscript" },
};

export const isElement = (n: PNode): n is PElement => "tagName" in n;
const isText = (n: PNode): n is PText => n.nodeName === "#text";
const attr = (el: PElement, name: string): string | undefined => el.attrs.find((a) => a.name === name)?.value;
const hasClass = (el: PElement, cls: string): boolean => (attr(el, "class") ?? "").split(/\s+/).includes(cls);
const collapse = (s: string): string => s.replace(/[ \t\r\n\f]+/g, " ");

export interface HtmlCtx {
  warn: Warnings;
  assets: AssetRegistry;
  maxDepth: number;
}

/** Inline items collected for the paragraph being built, and the finished blocks before it. */
interface Flow {
  out: DocNode[];
  run: Item[];
}
const newFlow = (): Flow => ({ out: [], run: [] });

/** Adding a mark drops the one it excludes in the schema (super- and subscript exclude each other). */
function withMark(marks: Mark[], m: Mark): Mark[] {
  const drop = m.type === "superscript" ? "subscript" : m.type === "subscript" ? "superscript" : null;
  return [...marks.filter((x) => x.type !== drop), m];
}

/** All text below a node, whitespace collapsed. Iterative: hostile nesting must not blow the stack. */
function textOf(root: PNode): string {
  let s = "";
  const stack: PNode[] = [root];
  while (stack.length) {
    const n = stack.pop()!;
    if (isText(n)) s += n.value;
    else if (isElement(n)) {
      if (n !== root && SKIP.has(n.tagName)) continue;
      if (n.tagName === "br") s += " ";
      for (let i = n.childNodes.length - 1; i >= 0; i--) stack.push(n.childNodes[i]!);
    }
  }
  return collapse(s).trim();
}

/** Text of a `<pre>`: newlines kept, `<br>` as a newline. */
function preText(root: PElement): string {
  let s = "";
  const stack: PNode[] = [root];
  while (stack.length) {
    const n = stack.pop()!;
    if (isText(n)) s += n.value;
    else if (isElement(n)) {
      if (SKIP.has(n.tagName)) continue;
      if (n.tagName === "br") s += "\n";
      for (let i = n.childNodes.length - 1; i >= 0; i--) stack.push(n.childNodes[i]!);
    }
  }
  return s.replace(/\n$/, "");
}

/** Trim the run for one paragraph: no leading, trailing or doubled spaces; breaks end a line. */
function trimRun(items: Item[]): Item[] {
  const out: Item[] = [];
  let atStart = true;
  const trimEnd = () => {
    const last = out[out.length - 1];
    if (last && !isSep(last) && last.type === "text") {
      const t: string = last.text.replace(/ +$/, "");
      if (t === "") out.pop();
      else out[out.length - 1] = { ...last, text: t };
    }
  };
  for (const it of items) {
    if (isSep(it)) {
      trimEnd();
      out.push(it);
      atStart = true;
    } else if (it.type === "text") {
      const t: string = atStart ? it.text.replace(/^ +/, "") : it.text;
      if (t === "") continue;
      out.push({ ...it, text: t });
      atStart = t.endsWith(" ");
    } else {
      out.push(it);
      atStart = false;
    }
  }
  trimEnd();
  return out;
}

/** Turn the pending inline run into paragraphs (split at `<br>`, lifted images as their own blocks). */
function flush(f: Flow, ctx: HtmlCtx): void {
  const items = trimRun(f.run);
  f.run = [];
  let cur: DocNode[] = [];
  let breaks = false;
  const end = () => {
    // A paragraph of only spaces or no-break spaces (a Word-style spacer) is not content.
    const blank = cur.every((n) => n.type === "text" && n.text.trim() === "");
    const p = paragraphOf(cur);
    if (!blank && p.type === "paragraph" && p.content) f.out.push(p);
    cur = [];
  };
  for (const it of items) {
    if (!isSep(it)) cur.push(it);
    else if (it.sep === "break") {
      breaks = true;
      end();
    } else {
      end();
      f.out.push(it.node);
    }
  }
  end();
  if (breaks) ctx.warn.at("line-break", "info", "Line breaks split the paragraph into separate paragraphs.");
}

function blocksIn(nodes: readonly PNode[], ctx: HtmlCtx, marks: Mark[], depth: number, dom: number): DocNode[] {
  const f = newFlow();
  flow(nodes, ctx, marks, f, depth, dom);
  flush(f, ctx);
  return f.out;
}

function flow(nodes: readonly PNode[], ctx: HtmlCtx, marks: Mark[], f: Flow, depth: number, dom: number): void {
  if (dom > MAX_DOM_DEPTH) throw new ImportError("too-deeply-nested", "The HTML is nested too deeply to import.");
  for (const n of nodes) {
    if (isText(n)) {
      const t = textNode(collapse(n.value), marks);
      if (t) f.run.push(t);
    } else if (isElement(n)) element(n, ctx, marks, f, depth, dom + 1);
  }
}

function element(el: PElement, ctx: HtmlCtx, marks: Mark[], f: Flow, depth: number, dom: number): void {
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
      f.run.push(...imageItems(attr(el, "src") ?? "", collapse(attr(el, "alt") ?? "").trim(), attr(el, "title"), undefined, ctx));
      return;
    case "a": {
      const href = attr(el, "href");
      if (href === undefined || href.trim().startsWith("#")) return flow(el.childNodes, ctx, marks, f, depth, dom);
      const safe = safeHref(href);
      if (safe) return flow(el.childNodes, ctx, [...marks, { type: "link", attrs: { href: safe } }], f, depth, dom);
      ctx.warn.at("unsafe-link", "warning", `Link removed (only http, https and mailto are kept): ${href.slice(0, 80)}`);
      return flow(el.childNodes, ctx, marks, f, depth, dom);
    }
    case "span": {
      if (hasClass(el, "footnote")) {
        const text = textOf(el);
        f.run.push(text ? { type: "footnote", content: [{ type: "text", text: cleanText(text) }] } : { type: "footnote" });
        return;
      }
      const small = hasClass(el, "small-caps") || /font-variant(?:-caps)?\s*:\s*(?:all-)?small-caps/i.test(attr(el, "style") ?? "");
      return flow(el.childNodes, ctx, small ? [...marks, { type: "smallCaps" }] : marks, f, depth, dom);
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
      const lang = /(?:^|\s)(?:language|lang)-([A-Za-z0-9_+#.-]{1,32})(?:\s|$)/.exec(attr(code ?? el, "class") ?? "")?.[1];
      const text = cleanText(preText(el));
      f.out.push({ type: "codeBlock", ...(lang ? { attrs: { language: lang } } : {}), ...(text ? { content: [{ type: "text", text }] } : {}) });
      return;
    }
    case "table":
      flush(f, ctx);
      return table(el, ctx, marks, f, depth, dom);
  }
  if (CONTAINERS.has(tag)) {
    flush(f, ctx);
    flow(el.childNodes, ctx, marks, f, depth, dom);
    flush(f, ctx);
    return;
  }
  if (!PLAIN_INLINE.has(tag)) ctx.warn.tally("unsupported-element", "warning", "Unsupported HTML elements were ignored; their text was kept.", `<${tag}>`);
  flow(el.childNodes, ctx, marks, f, depth, dom);
}

function tooDeep(el: PElement, ctx: HtmlCtx, f: Flow): void {
  ctx.warn.at("nesting-too-deep", "warning", `Nesting deeper than ${ctx.maxDepth} levels was flattened to text.`);
  const t = textNode(textOf(el));
  if (t) f.out.push(paragraphOf([t]));
}

function heading(el: PElement, ctx: HtmlCtx, marks: Mark[], f: Flow, depth: number, dom: number): void {
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
  f.out.push(content.length ? { type: "heading", attrs: { level }, content } : { type: "heading", attrs: { level } });
  for (const i of items) if (isSep(i) && i.sep === "block") f.out.push(i.node);
  f.out.push(...inner.out);
}

function list(el: PElement, ctx: HtmlCtx, marks: Mark[], f: Flow, depth: number, dom: number): void {
  const items: DocNode[] = [];
  let loose: Flow | null = null;
  const endLoose = () => {
    if (!loose) return;
    flush(loose, ctx);
    if (loose.out.length) items.push(listItemOf(loose.out));
    loose = null;
  };
  for (const c of el.childNodes) {
    if (isElement(c) && c.tagName === "li") {
      endLoose();
      items.push(listItemOf(blocksIn(c.childNodes, ctx, marks, depth + 1, dom + 1)));
    } else if (isText(c) && c.value.trim() === "") continue;
    else {
      // Stray content directly inside the list: keep it as an item of its own.
      loose ??= newFlow();
      flow([c], ctx, marks, loose, depth + 1, dom + 1);
    }
  }
  endLoose();
  if (el.tagName === "ol") {
    const start = Number.parseInt(attr(el, "start") ?? "", 10);
    f.out.push({ type: "orderedList", ...(Number.isInteger(start) && start >= 0 && start <= 999_999 && start !== 1 ? { attrs: { start } } : {}), content: items });
  } else f.out.push({ type: "bulletList", content: items });
  if (items.length === 0) f.out.pop();
}

function table(el: PElement, ctx: HtmlCtx, marks: Mark[], f: Flow, depth: number, dom: number): void {
  const rows: { tr: PElement; head: boolean }[] = [];
  for (const c of el.childNodes) {
    if (!isElement(c)) continue;
    if (c.tagName === "tr") rows.push({ tr: c, head: false });
    else if (c.tagName === "thead" || c.tagName === "tbody" || c.tagName === "tfoot") {
      for (const r of c.childNodes) if (isElement(r) && r.tagName === "tr") rows.push({ tr: r, head: c.tagName === "thead" });
    } else if (c.tagName === "caption") f.out.push(...blocksIn(c.childNodes, ctx, marks, depth, dom + 1));
  }
  let flattened = false;
  let merged = false;
  const cellEls = rows.map(({ tr }) => tr.childNodes.filter((c): c is PElement => isElement(c) && (c.tagName === "td" || c.tagName === "th")));
  const cells = cellEls.map((row) =>
    row.map((cell) => {
      if ((Number.parseInt(attr(cell, "colspan") ?? "", 10) || 1) > 1 || (Number.parseInt(attr(cell, "rowspan") ?? "", 10) || 1) > 1) merged = true;
      const r = cellParagraphs(blocksIn(cell.childNodes, ctx, marks, depth + 1, dom + 2));
      flattened ||= r.flattened;
      return r.paragraphs;
    }),
  );
  const first = rows[0];
  const headerRow = !!first && (first.head || (cellEls[0]!.length > 0 && cellEls[0]!.every((c) => c.tagName === "th")));
  const { node, padded } = tableOf(cells, headerRow);
  if (flattened) ctx.warn.at("table-complex", "warning", "Lists, images and nested tables inside table cells were flattened to paragraphs.");
  if (merged || padded) ctx.warn.at("table-merged", "warning", "Merged or missing table cells were replaced by empty cells so the table stays rectangular.");
  if (node) f.out.push(node);
}

export function parseSnippet(html: string): readonly PNode[] {
  const doc = parse(`<!DOCTYPE html><body>${html}`);
  const root = doc.childNodes.find((n): n is PElement => isElement(n) && n.tagName === "html");
  const body = root?.childNodes.find((n): n is PElement => isElement(n) && n.tagName === "body");
  return body?.childNodes ?? [];
}

/** Convert parsed nodes into top-level blocks. */
export const convert = (nodes: readonly PNode[], ctx: HtmlCtx): DocNode[] => guarded(() => blocksIn(nodes, ctx, [], 0, 0));

/** Blocks for an HTML snippet, sharing the caller's warnings and asset registry (used by the Markdown importer). */
export function htmlSnippetBlocks(html: string, ctx: HtmlCtx): DocNode[] {
  refuseHostileShape(html);
  return convert(guarded(() => parseSnippet(html)), ctx);
}

export const newCtx = (opts: ImportOptions): HtmlCtx => ({ warn: new Warnings(), assets: new AssetRegistry(), maxDepth: opts.maxNestingDepth ?? 32 });

/** The `<title>` text of a parsed document, if any. */
export function documentTitle(doc: { childNodes: readonly PNode[] }): string {
  const html = doc.childNodes.find((n): n is PElement => isElement(n) && n.tagName === "html");
  const head = html?.childNodes.find((n): n is PElement => isElement(n) && n.tagName === "head");
  const title = head?.childNodes.find((n): n is PElement => isElement(n) && n.tagName === "title");
  return title ? textOf(title) : "";
}
