import { parse, type DefaultTreeAdapterMap } from "parse5";
import type { Mark } from "@cadabracraft/shared";
import { AssetRegistry, Warnings } from "../common";
import type { ImportOptions } from "../types";

export type PNode = DefaultTreeAdapterMap["node"];
export type PElement = DefaultTreeAdapterMap["element"];
export type PText = DefaultTreeAdapterMap["textNode"];

/** Dropped with their content. `head` is skipped here because the file importer reads `<title>` separately. */
export const SKIP = new Set([
  "script",
  "style",
  "iframe",
  "object",
  "svg",
  "noscript",
  "template",
  "head",
  "title",
  "meta",
  "link",
  "base",
  "embed",
  "applet",
  "frame",
  "frameset",
  "col",
  "colgroup",
  "wbr",
  "select",
  "datalist",
]);
/** Block containers with no formatting of their own: their children are laid out as if they were not there. */
export const CONTAINERS = new Set([
  "html",
  "body",
  "div",
  "section",
  "article",
  "main",
  "header",
  "footer",
  "nav",
  "aside",
  "figure",
  "figcaption",
  "details",
  "summary",
  "center",
  "form",
  "fieldset",
  "legend",
  "address",
  "hgroup",
  "dl",
  "dt",
  "dd",
  "li",
  "tr",
  "td",
  "th",
  "thead",
  "tbody",
  "tfoot",
  "caption",
]);
/** Inline wrappers that carry nothing we keep and are not worth a warning. */
export const PLAIN_INLINE = new Set([
  "span",
  "font",
  "abbr",
  "cite",
  "time",
  "label",
  "bdi",
  "bdo",
  "data",
]);
export const MARK_TAGS: Record<string, Mark> = {
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
export const isText = (n: PNode): n is PText => n.nodeName === "#text";
export const attr = (el: PElement, name: string): string | undefined =>
  el.attrs.find((a) => a.name === name)?.value;
export const hasClass = (el: PElement, cls: string): boolean =>
  (attr(el, "class") ?? "").split(/\s+/).includes(cls);
export const collapse = (s: string): string => s.replace(/[ \t\r\n\f]+/g, " ");

export interface HtmlCtx {
  warn: Warnings;
  assets: AssetRegistry;
  maxDepth: number;
}

/** Adding a mark drops the one it excludes in the schema (super- and subscript exclude each other). */
export function withMark(marks: Mark[], m: Mark): Mark[] {
  const drop =
    m.type === "superscript" ? "subscript" : m.type === "subscript" ? "superscript" : null;
  return [...marks.filter((x) => x.type !== drop), m];
}

/** All text below a node, whitespace collapsed. Iterative: hostile nesting must not blow the stack. */
export function textOf(root: PNode): string {
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
export function preText(root: PElement): string {
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

export function parseSnippet(html: string): readonly PNode[] {
  const doc = parse(`<!DOCTYPE html><body>${html}`);
  const root = doc.childNodes.find((n): n is PElement => isElement(n) && n.tagName === "html");
  const body = root?.childNodes.find((n): n is PElement => isElement(n) && n.tagName === "body");
  // parse5 always builds <html> and <body> for a document, so the fallback is only there for the type checker.
  /* v8 ignore next -- @preserve */
  return body?.childNodes ?? [];
}

export const newCtx = (opts: ImportOptions): HtmlCtx => ({
  warn: new Warnings(),
  assets: new AssetRegistry(),
  maxDepth: opts.maxNestingDepth ?? 32,
});

/** The `<title>` text of a parsed document, if any. */
export function documentTitle(doc: { childNodes: readonly PNode[] }): string {
  const html = doc.childNodes.find((n): n is PElement => isElement(n) && n.tagName === "html");
  const head = html?.childNodes.find((n): n is PElement => isElement(n) && n.tagName === "head");
  const title = head?.childNodes.find((n): n is PElement => isElement(n) && n.tagName === "title");
  return title ? textOf(title) : "";
}
