import type { ChapterDoc, DocNode } from "@cadabracraft/shared";
import { ENTITY, escapeText } from "./escape";
import { inline } from "./marks";
import { MarkdownExportError, type Ctx, type MarkdownOptions } from "./types";

const attrsOf = (n: DocNode): Record<string, string | number | boolean | null> =>
  "attrs" in n && n.attrs ? n.attrs : {};

/** Code fence long enough that no backtick run in the code can close it. */
function codeBlock(n: DocNode): string {
  const text = (("content" in n ? n.content : undefined) ?? [])
    .map((k) => {
      if (k.type !== "text")
        throw new MarkdownExportError(`Unsupported node type in code block: ${k.type}`);
      return k.text;
    })
    .join("");
  const lang = attrsOf(n).language;
  if (lang !== undefined && lang !== null && typeof lang !== "string")
    throw new MarkdownExportError("A code block language must be a string");
  if (typeof lang === "string" && /[\s`]/.test(lang))
    throw new MarkdownExportError(`Code block language "${lang}" cannot be written in a fence`);
  const longest = Math.max(0, ...(text.match(/`+/g) ?? []).map((r) => r.length));
  const fence = "`".repeat(Math.max(3, longest + 1));
  return `${fence}${lang ?? ""}\n${text === "" ? "" : `${text}\n`}${fence}`;
}

function imageSource(src: string, base: string): string {
  if (src === "") throw new MarkdownExportError("An image without a source cannot be written");
  if (/[?#]/.test(src))
    throw new MarkdownExportError(
      `Image path "${src}" contains ? or #, which Markdown readers treat as a query or fragment`,
    );
  const relative = !/^([a-z][a-z0-9+.-]*:|\/)/i.test(src);
  return (relative ? base : "") + encodeURI(src).replace(/\(/g, "%28").replace(/\)/g, "%29");
}

function image(n: DocNode, ctx: Ctx): string {
  const a = attrsOf(n);
  const alt = escapeText(String(a.alt ?? ""), false, {});
  const title = a.title
    ? ` "${String(a.title).replace(/[\\"]/g, "\\$&").replace(ENTITY, "\\&")}"`
    : "";
  return `![${alt}](${imageSource(String(a.src ?? ""), ctx.opts.imageBase ?? "")}${title})`;
}

function table(n: DocNode, ctx: Ctx): string {
  const rows = ("content" in n ? n.content : undefined) ?? [];
  if (rows.length === 0) throw new MarkdownExportError("Table without rows");
  const cellsOf = (row: DocNode): DocNode[] => {
    if (row.type !== "tableRow")
      throw new MarkdownExportError(`Unsupported node type in table: ${row.type}`);
    return row.content ?? [];
  };
  const width = cellsOf(rows[0]!).length;
  const line = (row: DocNode): string => {
    const cells = cellsOf(row);
    if (cells.length === 0 || cells.length !== width)
      throw new MarkdownExportError("Table rows must all have the same, non-zero number of cells");
    const texts = cells.map((c) => {
      if (c.type !== "tableCell" && c.type !== "tableHeader")
        throw new MarkdownExportError(`Unsupported node type in table row: ${c.type}`);
      // A GFM cell is one line, so several paragraphs are joined with a space.
      return (c.content ?? [])
        .map((p) => {
          if (p.type !== "paragraph")
            throw new MarkdownExportError(`Unsupported node in a table cell: ${p.type}`);
          return inline(p.content, ctx, { table: true }).trim();
        })
        .filter((t) => t !== "")
        .join(" ");
    });
    return `| ${texts.join(" | ")} |`;
  };
  const headed = cellsOf(rows[0]!).every((c) => c.type === "tableHeader");
  // GFM requires a header row; a table without one gets an empty header.
  const head = headed
    ? line(rows[0]!)
    : `| ${Array.from({ length: width }, () => "").join(" | ")} |`;
  const body = (headed ? rows.slice(1) : rows).map(line);
  return [head, `| ${Array.from({ length: width }, () => "---").join(" | ")} |`, ...body].join(
    "\n",
  );
}

const indent = (text: string, n: number): string =>
  text
    .split("\n")
    .map((l, i) => (i === 0 || l === "" ? l : " ".repeat(n) + l))
    .join("\n");

/** What a list node's marker is: task lists use the bullet marker, so they count as bullet lists for alternating markers. */
const listKind = (n: DocNode): "bullet" | "ordered" | "" =>
  n.type === "bulletList" || n.type === "taskList"
    ? "bullet"
    : n.type === "orderedList"
      ? "ordered"
      : "";

function list(n: DocNode, ctx: Ctx, alt: boolean): string {
  const ordered = n.type === "orderedList";
  const task = n.type === "taskList";
  const start = attrsOf(n).start;
  const first =
    typeof start === "number" && Number.isInteger(start) && start >= 0 && start <= 999_999_999
      ? start
      : 1;
  const items = ("content" in n ? n.content : undefined) ?? [];
  return items
    .map((li, idx) => {
      if (li.type !== (task ? "taskItem" : "listItem"))
        throw new MarkdownExportError(`Unsupported node type in a list: ${li.type}`);
      // Alternate the marker for a list that directly follows a list of the same kind, or the two would merge.
      const marker = ordered ? `${first + idx}${alt ? ")" : "."}` : alt ? "*" : "-";
      const parts = task ? taskParts(li, ctx) : blockList(li.content, ctx);
      if (parts.length === 0) return marker;
      let body = parts[0]!;
      for (let i = 1; i < parts.length; i++)
        body +=
          (/^(?:[-*+]|\d+[.)])(?: |$)/.test(parts[i]!) && !/^ *(```|~~~)/.test(parts[i]!)
            ? "\n"
            : "\n\n") + parts[i];
      return `${marker} ${indent(body, marker.length + 1)}`;
    })
    .join("\n");
}

/** A task item's blocks with the GFM checkbox in front of the first paragraph (`[ ] ` or `[x] `). */
function taskParts(li: DocNode, ctx: Ctx): string[] {
  const checked = attrsOf(li).checked ?? false;
  if (typeof checked !== "boolean")
    throw new MarkdownExportError("A task item's checked value must be true or false");
  const kids = ("content" in li ? li.content : undefined) ?? [];
  const head = kids[0];
  if (head?.type !== "paragraph")
    throw new MarkdownExportError("A task item must start with a paragraph");
  // GFM needs text after the box; an empty item gets a no-break space (CadabraCraft reads it back as a blank item).
  const text = inline(head.content, ctx) || "&nbsp;";
  return [`[${checked ? "x" : " "}] ${text}`, ...blockList(kids.slice(1), ctx)];
}

/**
 * Definition lists in the Pandoc / PHP Markdown Extra form: a term line, then `:   description` lines. Descriptions hold
 * paragraphs only (a further paragraph is written as a further description line); hard breaks and other blocks have no form
 * that reads back, so they throw.
 */
function definitionList(n: DocNode, ctx: Ctx): string {
  const kids = ("content" in n ? n.content : undefined) ?? [];
  const lines: string[] = [];
  let prev = "";
  for (const k of kids) {
    if (k.type === "definitionTerm") {
      // A term that follows a description starts a new group, separated by a blank line.
      if (prev === "definitionDescription") lines.push("");
      lines.push(inline(k.content, ctx, { definition: true }).trim() || "&nbsp;");
    } else if (k.type === "definitionDescription") {
      const blocks = k.content ?? [];
      if (blocks[0]?.type !== "paragraph")
        throw new MarkdownExportError("A definition must start with a paragraph");
      blocks.forEach((b, i) => {
        if (b.type !== "paragraph")
          throw new MarkdownExportError(
            `A definition can hold paragraphs only in Markdown, not "${b.type}"`,
          );
        const text = inline(b.content, ctx, { definition: true }).trim();
        if (text !== "" || i === 0) lines.push(`:   ${text || "&nbsp;"}`);
      });
    } else throw new MarkdownExportError(`Unsupported node type in a definition list: ${k.type}`);
    prev = k.type;
  }
  if (lines.length === 0) throw new MarkdownExportError("Definition list without entries");
  return lines.join("\n");
}

function block(n: DocNode, ctx: Ctx, alt: boolean): string {
  const kids = "content" in n ? n.content : undefined;
  switch (n.type) {
    case "paragraph":
      return inline(kids, ctx);
    case "heading": {
      const level = Number(n.attrs?.level ?? 1);
      if (![1, 2, 3].includes(level))
        throw new MarkdownExportError(
          `Heading level ${String(n.attrs?.level)} is not allowed (levels 1-3 only)`,
        );
      const text = inline(kids, ctx, { heading: true }).replace(/(\s)(#+)$/, "$1\\$2");
      return `${"#".repeat(level)}${text ? ` ${text}` : ""}`;
    }
    case "blockquote": {
      const inner = blockList(kids, ctx).join("\n\n");
      return inner === ""
        ? ">"
        : inner
            .split("\n")
            .map((l) => (l === "" ? ">" : `> ${l}`))
            .join("\n");
    }
    case "bulletList":
    case "orderedList":
    case "taskList":
      return list(n, ctx, alt);
    case "definitionList":
      return definitionList(n, ctx);
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
export function blockList(nodes: DocNode[] | undefined, ctx: Ctx): string[] {
  const out: string[] = [];
  let prevType = "";
  let prevAlt = false;
  for (const n of nodes ?? []) {
    const kind = listKind(n);
    const alt: boolean = kind !== "" && prevType === kind ? !prevAlt : false;
    prevType = kind;
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
  if (!doc || doc.type !== "doc" || !Array.isArray(doc.content))
    throw new MarkdownExportError('A chapter document must be an object with type "doc"');
  const ctx: Ctx = { opts, notes: [] };
  const parts = blockList(doc.content, ctx);
  const offset = opts.footnoteOffset ?? 0;
  const defs = ctx.notes.map((t, i) => `[^${offset + i + 1}]: ${t}`.trimEnd());
  const body = parts.join("\n\n");
  const md = [body, defs.join("\n\n")].filter((s) => s !== "").join("\n\n");
  return { markdown: md === "" ? "" : `${md}\n`, footnotes: ctx.notes.length };
}
