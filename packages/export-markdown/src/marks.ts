import { isLangTag, type DocNode, type Mark } from "@cadabracraft/shared";
import { codeSpan, escapeText, linkDestination } from "./escape";
import { MarkdownExportError, type Ctx, type Item, type Where } from "./types";

/** Outer to inner. Inline code is always innermost (the editor schema lets it exclude every other mark). */
const MARK_ORDER: Mark["type"][] = [
  "link",
  "bold",
  "italic",
  "strike",
  "underline",
  "smallCaps",
  "lang",
  "superscript",
  "subscript",
  "code",
];
const HTML_MARKS: Partial<Record<Mark["type"], [string, string]>> = {
  underline: ["<u>", "</u>"],
  smallCaps: ['<span class="small-caps">', "</span>"],
  superscript: ["<sup>", "</sup>"],
  subscript: ["<sub>", "</sub>"],
};

const sameMark = (a: Mark | undefined, b: Mark | undefined): boolean =>
  !!a &&
  !!b &&
  a.type === b.type &&
  (a.attrs?.href ?? "") === (b.attrs?.href ?? "") &&
  (a.attrs?.lang ?? "") === (b.attrs?.lang ?? "");

function canonicalMarks(marks: Mark[] | undefined, ctx: Ctx): Mark[] {
  const seen = new Set<string>();
  const out: Mark[] = [];
  for (const m of marks ?? []) {
    // Comments are a writing tool: the text is written and the mark is dropped.
    const t0 = (m as { type?: unknown }).type;
    if (t0 === "comment" || t0 === "indexEntry" || t0 === "glossaryTerm") continue;
    const type = (m as { type?: unknown }).type;
    if (!MARK_ORDER.includes(type as Mark["type"]))
      throw new MarkdownExportError(`Unsupported mark type in chapter: ${String(type)}`);
    if (HTML_MARKS[m.type] && !ctx.opts.htmlMarks) {
      throw new MarkdownExportError(
        `The "${m.type}" mark has no Markdown syntax. Pass htmlMarks: true to write it as inline HTML (CadabraCraft reads it back; other tools may show the tags).`,
      );
    }
    if (m.type === "link" && !m.attrs?.href)
      throw new MarkdownExportError("A link mark without an href cannot be written");
    if (m.type === "lang") {
      if (!isLangTag(m.attrs?.lang))
        throw new MarkdownExportError("The language of a passage must be a BCP 47 tag");
      // Markdown has no syntax for a language: without the HTML option the passage is plain text.
      if (!ctx.opts.htmlMarks) continue;
    }
    if (seen.has(m.type)) continue;
    seen.add(m.type);
    out.push(m);
  }
  return out.sort((a, b) => MARK_ORDER.indexOf(a.type) - MARK_ORDER.indexOf(b.type));
}

/** Delimiters hug the text: whitespace at the edges moves outside them (`**a **` would not be emphasis). */
function wrap(inner: string, open: string, close: string): string {
  const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(inner)!;
  return m[2] === "" ? inner : `${m[1]}${open}${m[2]}${close}${m[3]}`;
}

type TextRun = Extract<Item, { kind: "text" }>[];

/** One run of text that shares its outermost mark, appended to `out`. */
function renderRun(
  out: string,
  run: TextRun,
  next: Item | undefined,
  ctx: Ctx,
  where: Where,
): string {
  const mark = run[0]!.marks[0]!;
  if (mark.type === "code") return out + codeSpan(run.map((r) => r.text).join(""), where);
  const inner = renderItems(
    run.map((r) => ({ ...r, marks: r.marks.slice(1) })),
    ctx,
    where,
    false,
  );
  if (mark.type === "link") {
    // "!" right before "[" would turn the link into an image.
    const head = out.endsWith("!") ? `${out.slice(0, -1)}\\!` : out;
    return `${head}[${inner}](${linkDestination(mark.attrs!.href!)})`;
  }
  if (mark.type === "bold") return out + wrap(inner, "**", "**");
  if (mark.type === "strike") return out + wrap(inner, "~~", "~~");
  if (mark.type === "italic") {
    // `**a***b*` is ambiguous, so italic next to a bold or italic neighbour uses underscores.
    const nm = next?.kind === "text" ? next.marks[0]?.type : undefined;
    const d = out.endsWith("*") || nm === "bold" || nm === "italic" ? "_" : "*";
    return out + wrap(inner, d, d);
  }
  const [open, close] =
    mark.type === "lang"
      ? [`<span lang="${mark.attrs!.lang}">`, "</span>"]
      : HTML_MARKS[mark.type]!;
  return out + wrap(inner, open, close);
}

function renderItems(items: Item[], ctx: Ctx, where: Where, atStart: boolean): string {
  let out = "";
  let i = 0;
  let afterBreak = false;
  while (i < items.length) {
    const it = items[i]!;
    if (it.kind === "raw") {
      out += it.md;
      afterBreak = it.lineBreak === true;
      i++;
      continue;
    }
    const mark = it.marks[0];
    if (!mark) {
      // After a hard break the text starts a new line, where "#", "-", "1." or "===" would be block syntax.
      out += escapeText(it.text, (atStart && out === "") || afterBreak, where);
      afterBreak = false;
      i++;
      continue;
    }
    afterBreak = false;
    let j = i;
    while (j < items.length) {
      const k = items[j]!;
      if (k.kind !== "text" || !sameMark(k.marks[0], mark)) break;
      j++;
    }
    const run = items.slice(i, j) as Extract<Item, { kind: "text" }>[];
    const next = items[j];
    out = renderRun(out, run, next, ctx, where);
    i = j;
  }
  return out;
}

export function inline(nodes: DocNode[] | undefined, ctx: Ctx, where: Where = {}): string {
  const items: Item[] = [];
  for (const n of nodes ?? []) {
    const type = n.type as string;
    if (n.type === "text") {
      if (n.text.includes("\n"))
        throw new MarkdownExportError("Text contains a line break; use a hard break node");
      if (n.text !== "")
        items.push({ kind: "text", text: n.text, marks: canonicalMarks(n.marks, ctx) });
    } else if (n.type === "footnote") {
      if (where.note) throw new MarkdownExportError("A footnote cannot contain another footnote");
      const text = inline(n.content, ctx, { note: true });
      ctx.notes.push(text);
      items.push({ kind: "raw", md: `[^${(ctx.opts.footnoteOffset ?? 0) + ctx.notes.length}]` });
    } else if (type === "hardBreak") {
      if (where.table || where.heading || where.note || where.definition)
        throw new MarkdownExportError(
          "A hard break cannot be written in a heading, table cell, footnote or definition list",
        );
      items.push({ kind: "raw", md: "\\\n", lineBreak: true });
    } else {
      throw new MarkdownExportError(`Unsupported node type in inline content: ${type}`);
    }
  }
  // A backslash at the very end of a block is a literal backslash, and a trailing break shows nothing anyway.
  for (let last = items.at(-1); last?.kind === "raw" && last.lineBreak; last = items.at(-1))
    items.pop();
  return renderItems(items, ctx, where, true);
}
