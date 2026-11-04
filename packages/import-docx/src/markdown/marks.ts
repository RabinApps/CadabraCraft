import { isLangTag, type DocNode, type Mark } from "@cadabracraft/shared";
import type { Definition, FootnoteDefinition, Nodes, PhrasingContent } from "mdast";
import {
  AssetRegistry,
  Warnings,
  type Item,
  imageItems,
  isSep,
  mergeInline,
  safeHref,
  textNode,
} from "../common";

export interface Ctx {
  warn: Warnings;
  assets: AssetRegistry;
  defs: Map<string, Definition>;
  footnotes: Map<string, FootnoteDefinition>;
  usedFootnotes: Set<string>;
  maxDepth: number;
  /** The Markdown text, to tell an escaped ":" from a typed one (the parser drops the backslash). */
  source?: string;
}

export const lineOf = (n: { position?: { start: { line: number } } | undefined }) =>
  n.position?.start.line;

/** Flatten any mdast node to plain text. */
export function toText(n: Nodes): string {
  if ("value" in n && typeof n.value === "string") return n.value;
  if (n.type === "image" || n.type === "imageReference") return n.alt ?? "";
  if ("children" in n)
    return (n.children as Nodes[])
      .map(toText)
      .join(n.type === "root" || n.type === "list" || n.type === "table" ? "\n" : "");
  return "";
}

/** The inline HTML tags `export-markdown` writes for `htmlMarks`: `<u>`, `<span class="small-caps">`, `<span lang="xx">`, `<sup>`, `<sub>`. */
const HTML_MARK = /^<(\/)?(u|sup|sub|span)(\s[^>]*)?>$/i;
function htmlMark(value: string): { close: boolean; tag: string; mark: Mark } | null {
  const m = HTML_MARK.exec(value.trim());
  if (!m) return null;
  const tag = m[2]!.toLowerCase();
  const close = !!m[1];
  if (tag === "span") {
    // A close tag has no attributes and pairs with the nearest open span of any kind (its mark is not used).
    if ((close && !m[3]) || /^\s+class\s*=\s*["']small-caps["']\s*$/i.test(m[3] ?? ""))
      return { close, tag, mark: { type: "smallCaps" } };
    const lang = /^\s+lang\s*=\s*(?:"([^"]*)"|'([^']*)')\s*$/i.exec(m[3] ?? "");
    const value = lang?.[1] ?? lang?.[2];
    // (CommonMark only parses attributes on an opening tag, so a close tag never reaches here with a lang.)
    return isLangTag(value) ? { close, tag, mark: { type: "lang", attrs: { lang: value } } } : null;
  }
  if (m[3]) return null;
  return {
    close,
    tag,
    mark: { type: tag === "u" ? "underline" : tag === "sup" ? "superscript" : "subscript" },
  };
}

const MAX_OPEN_MARKS = 32;

/** Indexes of inline `html` siblings that are balanced open/close pairs of the four mark tags (a span close only pairs with a small-caps open). */
function pairedHtmlMarks(nodes: PhrasingContent[]): Set<number> {
  const paired = new Set<number>();
  const open: { tag: string; index: number }[] = [];
  nodes.forEach((n, index) => {
    if (n.type !== "html") return;
    const h = htmlMark(n.value);
    if (!h) return;
    // Deeper nesting than any real text uses is left as literal text (and keeps the pairing and the mark list cheap).
    if (!h.close) return void (open.length < MAX_OPEN_MARKS && open.push({ tag: h.tag, index }));
    for (let i = open.length - 1; i >= 0; i--) {
      if (open[i]!.tag !== h.tag) continue;
      paired.add(open[i]!.index).add(index);
      open.splice(i, 1);
      break;
    }
  });
  return paired;
}

export function inlines(
  nodes: PhrasingContent[],
  ctx: Ctx,
  baseMarks: Mark[],
  inNote = false,
): Item[] {
  const out: Item[] = [];
  const paired = pairedHtmlMarks(nodes);
  const openMarks: { tag: string; mark: Mark }[] = [];
  let marks = baseMarks;
  for (const [index, n] of nodes.entries()) {
    switch (n.type) {
      case "text": {
        const t = textNode(n.value.replace(/\n/g, " "), marks);
        if (t) out.push(t);
        break;
      }
      case "emphasis":
        out.push(...inlines(n.children, ctx, [...marks, { type: "italic" }], inNote));
        break;
      case "strong":
        out.push(...inlines(n.children, ctx, [...marks, { type: "bold" }], inNote));
        break;
      case "delete":
        out.push(...inlines(n.children, ctx, [...marks, { type: "strike" }], inNote));
        break;
      case "inlineCode": {
        const t = textNode(n.value, [...marks, { type: "code" }]);
        if (t) out.push(t);
        break;
      }
      case "link":
      case "linkReference": {
        const url = n.type === "link" ? n.url : ctx.defs.get(n.identifier.toLowerCase())?.url;
        const href = url === undefined ? null : safeHref(url);
        if (href)
          out.push(
            ...inlines(n.children, ctx, [...marks, { type: "link", attrs: { href } }], inNote),
          );
        else {
          ctx.warn.at(
            "unsafe-link",
            "warning",
            `Link removed (only http, https and mailto are kept): ${(url ?? "unresolved reference").slice(0, 80)}`,
            lineOf(n),
          );
          out.push(...inlines(n.children, ctx, marks, inNote));
        }
        break;
      }
      case "break":
        out.push({ sep: "break" });
        break;
      case "image":
      case "imageReference": {
        const d =
          n.type === "imageReference" ? ctx.defs.get(n.identifier.toLowerCase()) : undefined;
        const url = n.type === "image" ? n.url : d?.url;
        const title = n.type === "image" ? n.title : d?.title;
        if (url === undefined) {
          const t = textNode(n.alt ?? "", marks);
          if (t) out.push(t);
        } else out.push(...imageItems(url, n.alt ?? "", title, lineOf(n), ctx));
        break;
      }
      case "html": {
        const h = paired.has(index) ? htmlMark(n.value) : null;
        if (h) {
          if (!h.close) openMarks.push({ tag: h.tag, mark: h.mark });
          else {
            const at = openMarks.map((o) => o.tag).lastIndexOf(h.tag);
            // pairedHtmlMarks only pairs a close tag with an earlier open tag of the same name, so `at` is always found.
            /* v8 ignore else -- @preserve */
            if (at >= 0) openMarks.splice(at, 1);
          }
          marks = [...baseMarks, ...openMarks.map((o) => o.mark)];
          break;
        }
        ctx.warn.at(
          "html",
          "warning",
          "Raw HTML is not supported; its text was kept literally.",
          lineOf(n),
        );
        const t = textNode(n.value, marks);
        if (t) out.push(t);
        break;
      }
      case "footnoteReference": {
        const def = ctx.footnotes.get(n.identifier.toLowerCase());
        if (inNote) {
          ctx.warn.at(
            "footnote-nested",
            "warning",
            "A footnote reference inside a footnote was dropped.",
            lineOf(n),
          );
        } else if (!def) {
          ctx.warn.at(
            "footnote-undefined",
            "warning",
            `Footnote [^${n.label ?? n.identifier}] has no definition.`,
            lineOf(n),
          );
        } else {
          ctx.usedFootnotes.add(n.identifier.toLowerCase());
          out.push(footnoteNode(def, ctx));
        }
        break;
      }
      default: {
        ctx.warn.at(
          "unsupported-node",
          "warning",
          `Unsupported inline element "${(n as { type: string }).type}" was kept as text.`,
          lineOf(n),
        );
        const t = textNode(toText(n), marks);
        if (t) out.push(t);
      }
    }
  }
  return out;
}

function footnoteNode(def: FootnoteDefinition, ctx: Ctx): DocNode {
  const parts: DocNode[] = [];
  let complex = false;
  for (const child of def.children) {
    if (parts.length) parts.push({ type: "text", text: " " });
    if (child.type === "paragraph") {
      for (const it of inlines(child.children, ctx, [], true)) {
        // Inlines inside a note are only text or separators, so the final "otherwise" is unreachable.
        /* v8 ignore else -- @preserve */
        if (isSep(it)) {
          complex = true;
          if (it.sep === "break") parts.push({ type: "text", text: " " });
        } else if (it.type === "text") parts.push(it);
      }
    } else {
      complex = true;
      const t = textNode(toText(child).replace(/\s+/g, " ").trim());
      if (t) parts.push(t);
    }
  }
  if (complex)
    ctx.warn.at(
      "footnote-complex",
      "info",
      `Footnote [^${def.label ?? def.identifier}] had non-paragraph content; it was flattened to text.`,
      lineOf(def),
    );
  const content = mergeInline(parts);
  while (content[0]?.type === "text" && content[0].text.trim() === "") content.shift();
  return content.length ? { type: "footnote", content } : { type: "footnote" };
}
