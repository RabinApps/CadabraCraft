import type { ChapterDoc, DocNode, Mark } from "@cadabracraft/shared";

/** Thrown for anything that has no faithful Markdown form. Content is never silently dropped. */
export class MarkdownExportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MarkdownExportError";
  }
}

export interface MarkdownOptions {
  /**
   * Write underline, small caps, superscript and subscript as inline HTML (`<u>`, `<span class="small-caps">`, `<sup>`,
   * `<sub>`). Off by default: Markdown has no syntax for them, so other tools may show the tags as text (the CadabraCraft
   * importer reads exactly these four tags back as marks). Without this option such marks make the export throw.
   */
  htmlMarks?: boolean;
  /** Footnote labels start at `footnoteOffset + 1` (used to keep labels unique when chapters are joined). Default 0. */
  footnoteOffset?: number;
  /** Prefix for relative image paths, e.g. `../` when the file is written to `exports/`. Default none. */
  imageBase?: string;
}

interface Ctx {
  opts: MarkdownOptions;
  /** Rendered footnote texts, in order of appearance. */
  notes: string[];
}

interface Where {
  /** Inside a table cell: `|` must be escaped and a line break cannot be written. */
  table?: boolean;
  /** Inside a heading: a line break cannot be written. */
  heading?: boolean;
  /** Inside a footnote: footnotes cannot nest. */
  note?: boolean;
}

type Item = { kind: "text"; text: string; marks: Mark[] } | { kind: "raw"; md: string };

/** Outer to inner. Inline code is always innermost (the editor schema lets it exclude every other mark). */
const MARK_ORDER: Mark["type"][] = ["link", "bold", "italic", "strike", "underline", "smallCaps", "superscript", "subscript", "code"];
const HTML_MARKS: Partial<Record<Mark["type"], [string, string]>> = {
  underline: ["<u>", "</u>"],
  smallCaps: ['<span class="small-caps">', "</span>"],
  superscript: ["<sup>", "</sup>"],
  subscript: ["<sub>", "</sub>"],
};

const attrsOf = (n: DocNode): Record<string, string | number | null> => ("attrs" in n && n.attrs ? n.attrs : {});

const ENTITY =/&(?=#?[A-Za-z0-9]+;)/g;

/** Backslash-escape everything in `text` that Markdown (CommonMark + GFM) could read as syntax. */
function escapeText(text: string, atStart: boolean, where: Where): string {
  let s = text.replace(/[\\`*_[\]<>~]/g, "\\$&").replace(ENTITY, "\\&");
  if (where.table) s = s.replace(/\|/g, "\\|");
  // Bare URLs, "www." hosts and e-mail addresses are left alone: GFM linkifies them in the parsed text, so escaping cannot prevent it.
  if (atStart) {
    s = s
      .replace(/^(#{1,6})(?=[ \t]|$)/, "\\$1")
      .replace(/^([-+])/, "\\$1")
      .replace(/^(\d{1,9})([.)])(?=[ \t]|$)/, "$1\\$2");
  }
  return s;
}

function codeSpan(text: string, where: Where): string {
  const body = where.table ? text.replace(/\|/g, "\\|") : text;
  const longest = Math.max(0, ...(body.match(/`+/g) ?? []).map((r) => r.length));
  const fence = "`".repeat(longest + 1);
  const pad = /^`|`$/.test(body) || (/^ .* $/.test(body) && body.trim() !== "") ? " " : "";
  return `${fence}${pad}${body}${pad}${fence}`;
}

/** A link destination that survives the importer: `<...>` form when it holds spaces, angle brackets or unbalanced parentheses. */
function linkDestination(href: string): string {
  let depth = 0;
  let balanced = true;
  for (const ch of href) {
    if (ch === "(") depth++;
    else if (ch === ")" && --depth < 0) balanced = false;
  }
  if (depth !== 0) balanced = false;
  const esc = href.replace(/[\\]/g, "\\\\").replace(ENTITY, "\\&");
  if (href === "" || /[\s<>]/.test(href) || !balanced || /[\u0000-\u001f]/.test(href)) return `<${esc.replace(/[<>]/g, "\\$&")}>`;
  return esc;
}

const sameMark = (a: Mark | undefined, b: Mark | undefined): boolean => !!a && !!b && a.type === b.type && (a.attrs?.href ?? "") === (b.attrs?.href ?? "");

function canonicalMarks(marks: Mark[] | undefined, ctx: Ctx): Mark[] {
  const seen = new Set<string>();
  const out: Mark[] = [];
  for (const m of marks ?? []) {
    const type = (m as { type?: unknown }).type;
    if (!MARK_ORDER.includes(type as Mark["type"])) throw new MarkdownExportError(`Unsupported mark type in chapter: ${String(type)}`);
    if (HTML_MARKS[m.type] && !ctx.opts.htmlMarks) {
      throw new MarkdownExportError(`The "${m.type}" mark has no Markdown syntax. Pass htmlMarks: true to write it as inline HTML (CadabraCraft reads it back; other tools may show the tags).`);
    }
    if (m.type === "link" && !m.attrs?.href) throw new MarkdownExportError("A link mark without an href cannot be written");
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

function renderItems(items: Item[], ctx: Ctx, where: Where, atStart: boolean): string {
  let out = "";
  let i = 0;
  while (i < items.length) {
    const it = items[i]!;
    if (it.kind === "raw") {
      out += it.md;
      i++;
      continue;
    }
    const mark = it.marks[0];
    if (!mark) {
      out += escapeText(it.text, atStart && out === "", where);
      i++;
      continue;
    }
    let j = i;
    while (j < items.length) {
      const k = items[j]!;
      if (k.kind !== "text" || !sameMark(k.marks[0], mark)) break;
      j++;
    }
    const run = items.slice(i, j) as Extract<Item, { kind: "text" }>[];
    const next = items[j];
    if (mark.type === "code") {
      out += codeSpan(run.map((r) => r.text).join(""), where);
    } else {
      const inner = renderItems(run.map((r) => ({ ...r, marks: r.marks.slice(1) })), ctx, where, false);
      if (mark.type === "link") {
        // "!" right before "[" would turn the link into an image.
        if (out.endsWith("!")) out = `${out.slice(0, -1)}\\!`;
        out += `[${inner}](${linkDestination(mark.attrs!.href!)})`;
      }
      else if (mark.type === "bold") out += wrap(inner, "**", "**");
      else if (mark.type === "strike") out += wrap(inner, "~~", "~~");
      else if (mark.type === "italic") {
        // `**a***b*` is ambiguous, so italic next to a bold or italic neighbour uses underscores.
        const nm = next?.kind === "text" ? next.marks[0]?.type : undefined;
        const d = out.endsWith("*") || nm === "bold" || nm === "italic" ? "_" : "*";
        out += wrap(inner, d, d);
      } else {
        const [open, close] = HTML_MARKS[mark.type]!;
        out += wrap(inner, open, close);
      }
    }
    i = j;
  }
  return out;
}

function inline(nodes: DocNode[] | undefined, ctx: Ctx, where: Where = {}): string {
  const items: Item[] = [];
  for (const n of nodes ?? []) {
    const type = n.type as string;
    if (n.type === "text") {
      if (n.text.includes("\n")) throw new MarkdownExportError("Text contains a line break; use a hard break node");
      if (n.text !== "") items.push({ kind: "text", text: n.text, marks: canonicalMarks(n.marks, ctx) });
    } else if (n.type === "footnote") {
      if (where.note) throw new MarkdownExportError("A footnote cannot contain another footnote");
      const text = inline(n.content, ctx, { note: true });
      ctx.notes.push(text);
      items.push({ kind: "raw", md: `[^${(ctx.opts.footnoteOffset ?? 0) + ctx.notes.length}]` });
    } else if (type === "hardBreak") {
      if (where.table || where.heading || where.note) throw new MarkdownExportError("A hard break cannot be written in a heading, table cell or footnote");
      items.push({ kind: "raw", md: "\\\n" });
    } else {
      throw new MarkdownExportError(`Unsupported node type in inline content: ${type}`);
    }
  }
  return renderItems(items, ctx, where, true);
}

/** Code fence long enough that no backtick run in the code can close it. */
function codeBlock(n: DocNode): string {
  const text = (("content" in n ? n.content : undefined) ?? [])
    .map((k) => {
      if (k.type !== "text") throw new MarkdownExportError(`Unsupported node type in code block: ${k.type}`);
      return k.text;
    })
    .join("");
  const lang = attrsOf(n).language;
  if (lang !== undefined && lang !== null && typeof lang !== "string") throw new MarkdownExportError("A code block language must be a string");
  if (typeof lang === "string" && /[\s`]/.test(lang)) throw new MarkdownExportError(`Code block language "${lang}" cannot be written in a fence`);
  const longest = Math.max(0, ...(text.match(/`+/g) ?? []).map((r) => r.length));
  const fence = "`".repeat(Math.max(3, longest + 1));
  return `${fence}${lang ?? ""}\n${text === "" ? "" : `${text}\n`}${fence}`;
}

function imageSource(src: string, base: string): string {
  if (src === "") throw new MarkdownExportError("An image without a source cannot be written");
  if (/[?#]/.test(src)) throw new MarkdownExportError(`Image path "${src}" contains ? or #, which Markdown readers treat as a query or fragment`);
  const relative = !/^([a-z][a-z0-9+.-]*:|\/)/i.test(src);
  return (relative ? base : "") + encodeURI(src).replace(/\(/g, "%28").replace(/\)/g, "%29");
}

function image(n: DocNode, ctx: Ctx): string {
  const a = attrsOf(n);
  const alt = escapeText(String(a.alt ?? ""), false, {});
  const title = a.title ? ` "${String(a.title).replace(/[\\"]/g, "\\$&").replace(ENTITY, "\\&")}"` : "";
  return `![${alt}](${imageSource(String(a.src ?? ""), ctx.opts.imageBase ?? "")}${title})`;
}

function table(n: DocNode, ctx: Ctx): string {
  const rows = ("content" in n ? n.content : undefined) ?? [];
  if (rows.length === 0) throw new MarkdownExportError("Table without rows");
  const cellsOf = (row: DocNode): DocNode[] => {
    if (row.type !== "tableRow") throw new MarkdownExportError(`Unsupported node type in table: ${row.type}`);
    return row.content ?? [];
  };
  const width = cellsOf(rows[0]!).length;
  const line = (row: DocNode): string => {
    const cells = cellsOf(row);
    if (cells.length === 0 || cells.length !== width) throw new MarkdownExportError("Table rows must all have the same, non-zero number of cells");
    const texts = cells.map((c) => {
      if (c.type !== "tableCell" && c.type !== "tableHeader") throw new MarkdownExportError(`Unsupported node type in table row: ${c.type}`);
      // A GFM cell is one line, so several paragraphs are joined with a space.
      return (c.content ?? [])
        .map((p) => {
          if (p.type !== "paragraph") throw new MarkdownExportError(`Unsupported node in a table cell: ${p.type}`);
          return inline(p.content, ctx, { table: true }).trim();
        })
        .filter((t) => t !== "")
        .join(" ");
    });
    return `| ${texts.join(" | ")} |`;
  };
  const headed = cellsOf(rows[0]!).every((c) => c.type === "tableHeader");
  // GFM requires a header row; a table without one gets an empty header.
  const head = headed ? line(rows[0]!) : `| ${Array.from({ length: width }, () => "").join(" | ")} |`;
  const body = (headed ? rows.slice(1) : rows).map(line);
  return [head, `| ${Array.from({ length: width }, () => "---").join(" | ")} |`, ...body].join("\n");
}

const indent = (text: string, n: number): string =>
  text.split("\n").map((l, i) => (i === 0 || l === "" ? l : " ".repeat(n) + l)).join("\n");

function list(n: DocNode, ctx: Ctx, alt: boolean): string {
  const ordered = n.type === "orderedList";
  const start = attrsOf(n).start;
  const first = typeof start === "number" && Number.isInteger(start) && start >= 0 && start <= 999_999_999 ? start : 1;
  const items = ("content" in n ? n.content : undefined) ?? [];
  return items
    .map((li, idx) => {
      if (li.type !== "listItem") throw new MarkdownExportError(`Unsupported node type in a list: ${li.type}`);
      // Alternate the marker for a list that directly follows a list of the same kind, or the two would merge.
      const marker = ordered ? `${first + idx}${alt ? ")" : "."}` : alt ? "*" : "-";
      const parts = blockList(li.content, ctx);
      if (parts.length === 0) return marker;
      let body = parts[0]!;
      for (let i = 1; i < parts.length; i++) body += (/^(?:[-*+]|\d+[.)])(?: |$)/.test(parts[i]!) && !/^ *(```|~~~)/.test(parts[i]!) ? "\n" : "\n\n") + parts[i];
      return `${marker} ${indent(body, marker.length + 1)}`;
    })
    .join("\n");
}

function block(n: DocNode, ctx: Ctx, alt: boolean): string {
  const kids = "content" in n ? n.content : undefined;
  switch (n.type) {
    case "paragraph":
      return inline(kids, ctx);
    case "heading": {
      const level = Number(n.attrs?.level ?? 1);
      if (![1, 2, 3].includes(level)) throw new MarkdownExportError(`Heading level ${String(n.attrs?.level)} is not allowed (levels 1-3 only)`);
      const text = inline(kids, ctx, { heading: true }).replace(/(\s)(#+)$/, "$1\\$2");
      return `${"#".repeat(level)}${text ? ` ${text}` : ""}`;
    }
    case "blockquote": {
      const inner = blockList(kids, ctx).join("\n\n");
      return inner === "" ? ">" : inner.split("\n").map((l) => (l === "" ? ">" : `> ${l}`)).join("\n");
    }
    case "bulletList":
    case "orderedList":
      return list(n, ctx, alt);
    case "codeBlock":
      return codeBlock(n);
    case "table":
      return table(n, ctx);
    case "sceneBreak":
      return "* * *";
    case "image":
      return image(n, ctx);
    default:
      throw new MarkdownExportError(`Unsupported node type in chapter: ${n.type}`);
  }
}

/** Rendered blocks, empty ones (empty paragraphs) left out. */
function blockList(nodes: DocNode[] | undefined, ctx: Ctx): string[] {
  const out: string[] = [];
  let prevType = "";
  let prevAlt = false;
  for (const n of nodes ?? []) {
    const isList = n.type === "bulletList" || n.type === "orderedList";
    const alt: boolean = isList && prevType === n.type ? !prevAlt : false;
    prevType = isList ? n.type : "";
    prevAlt = alt;
    const md = block(n, ctx, alt);
    if (md !== "") out.push(md);
  }
  return out;
}

export interface RenderedChapter {
  markdown: string;
  /** Number of footnotes written; the next chapter continues after them. */
  footnotes: number;
}

export function renderChapter(doc: ChapterDoc, opts: MarkdownOptions = {}): RenderedChapter {
  if (!doc || doc.type !== "doc" || !Array.isArray(doc.content)) throw new MarkdownExportError('A chapter document must be an object with type "doc"');
  const ctx: Ctx = { opts, notes: [] };
  const parts = blockList(doc.content, ctx);
  const offset = opts.footnoteOffset ?? 0;
  const defs = ctx.notes.map((t, i) => `[^${offset + i + 1}]: ${t}`.trimEnd());
  const body = parts.join("\n\n");
  const md = [body, defs.join("\n\n")].filter((s) => s !== "").join("\n\n");
  return { markdown: md === "" ? "" : `${md}\n`, footnotes: ctx.notes.length };
}
