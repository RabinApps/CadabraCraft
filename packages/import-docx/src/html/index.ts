import { parse } from "parse5";
import type { DocNode } from "@cadabracraft/shared";
import { mergeInline, plainText, splitChapters } from "../common";
import { ImportError, type ImportOptions, type ImportResult, type ImportWarning } from "../types";
import {
  documentTitle,
  htmlSnippetBlocks,
  convert,
  isElement,
  newCtx,
  parseSnippet,
  type PNode,
} from "./convert";
import { guarded, refuseHostileShape } from "./guards";

export { htmlSnippetBlocks, type HtmlCtx } from "./convert";

/** Elements that make `looksLikeHtml` true. */
const RECOGNISED = new Set([
  "p",
  "div",
  "span",
  "b",
  "strong",
  "i",
  "em",
  "u",
  "s",
  "del",
  "strike",
  "a",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "ul",
  "ol",
  "li",
  "blockquote",
  "pre",
  "code",
  "table",
  "thead",
  "tbody",
  "tfoot",
  "tr",
  "td",
  "th",
  "caption",
  "br",
  "hr",
  "sup",
  "sub",
  "img",
]);

const kids = (n: PNode): readonly PNode[] => ("childNodes" in n ? n.childNodes : []);

function guardSize(html: string, opts: ImportOptions): void {
  const max = opts.maxInputChars ?? 50_000_000;
  if (html.length > max)
    throw new ImportError("input-too-large", `HTML input is larger than ${max} characters.`);
  refuseHostileShape(html);
}

/** Blocks for a pasted HTML snippet. Pure: no DOM, disk or network access. */
export function htmlToBlocks(
  html: string,
  opts: ImportOptions = {},
): { blocks: DocNode[]; warnings: ImportWarning[] } {
  guardSize(html, opts);
  const ctx = newCtx(opts);
  const blocks = htmlSnippetBlocks(html, ctx);
  return { blocks, warnings: ctx.warn.list() };
}

/** Inline nodes for a snippet with no block wrapper: paragraphs are joined with a space, images and other blocks are left out. */
export function htmlToInline(html: string, opts: ImportOptions = {}): DocNode[] {
  const { blocks } = htmlToBlocks(html, opts);
  const out: DocNode[] = [];
  for (const b of blocks) {
    if (b.type === "image" || b.type === "sceneBreak") continue;
    const inner =
      b.type === "paragraph" || b.type === "heading"
        ? (b.content ?? [])
        : [{ type: "text", text: plainText([b]) } as DocNode];
    if (out.length && inner.length) out.push({ type: "text", text: " " });
    out.push(...inner);
  }
  return mergeInline(out);
}

/** A well-formed tag (attribute names must look like names), so `if (a<b && c>d)` is not read as a `<b>` element. */
const TAG_LIKE =
  /<\/?[A-Za-z][A-Za-z0-9]*(?:\s+[A-Za-z_:][-\w:.]*(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+))?)*\s*\/?>/;

/** True only when the text parses to at least one recognised element, so `a < b` and `<3` are not mistaken for HTML. */
export function looksLikeHtml(text: string): boolean {
  try {
    if (typeof text !== "string" || !TAG_LIKE.test(text)) return false;
    try {
      refuseHostileShape(text);
    } catch {
      return true;
    }
    const stack: PNode[] = [...guarded(() => parseSnippet(text))];
    while (stack.length) {
      const n = stack.pop()!;
      if (!isElement(n)) continue;
      if (RECOGNISED.has(n.tagName)) return true;
      for (const c of kids(n)) stack.push(c);
    }
    return false;
  } catch (e) {
    // Too deep to import still counts as HTML (the import will say why it refuses); any other failure is "not HTML".
    return e instanceof ImportError && e.code === "too-deeply-nested";
  }
}

/** Import an HTML document (`.html`, `.htm`) as chapters. Pure: no DOM, disk or network access; images are never fetched. */
export function importHtml(html: string, opts: ImportOptions = {}): ImportResult {
  guardSize(html, opts);
  const ctx = newCtx(opts);
  const doc = guarded(() => parse(html.replace(/^\ufeff/, "")));
  const top = convert(doc.childNodes, ctx);
  const firstHeading = top.find((b) => b.type === "heading");
  const untitled =
    documentTitle(doc) ||
    (firstHeading
      ? plainText("content" in firstHeading ? firstHeading.content : undefined).trim()
      : "") ||
    opts.untitledTitle;
  const chapters = splitChapters(
    top,
    { ...opts, ...(untitled ? { untitledTitle: untitled } : {}) },
    ctx.warn,
  );
  return { chapters, warnings: ctx.warn.list(), assets: ctx.assets.assets };
}
