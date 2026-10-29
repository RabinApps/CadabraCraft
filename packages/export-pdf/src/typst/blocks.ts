import { wordStarts, type DocNode } from "@cadabracraft/shared";
import { escapeMarkup, typstString } from "../escape";
import { MissingAssetError, PdfExportError } from "../errors";
import { unsupported, type Ctx } from "./ctx";
import { inline } from "./inline";
import { inch } from "./units";

const IMAGE_EXT = new Set(["png", "jpg", "jpeg", "gif", "svg", "webp"]);

export function imagePath(src: string, ctx: Ctx): string {
  const known = ctx.images.get(src);
  if (known) return known;
  const ext = /\.([A-Za-z0-9]+)(?:[?#].*)?$/.exec(src)?.[1]?.toLowerCase() ?? "";
  if (!IMAGE_EXT.has(ext))
    throw new PdfExportError(
      `Unsupported image type for "${src}" (use png, jpg, gif, svg or webp)`,
    );
  const path = `assets/img-${ctx.images.size + 1}.${ext === "jpeg" ? "jpg" : ext}`;
  ctx.images.set(src, path);
  return path;
}

function listItems(kids: DocNode[] | undefined, ctx: Ctx): string {
  return (kids ?? [])
    .map((li) => {
      if (li.type !== "listItem") return unsupported(li.type);
      return `  [\n${blocks(li.content, ctx)}\n  ]`;
    })
    .join(",\n");
}

/** A task list is an `enum` whose numbering draws a box, ticked for the items in `checked`. */
function taskList(n: DocNode, ctx: Ctx): string {
  const checked: number[] = [];
  const items = ("content" in n ? n.content : undefined) ?? [];
  const bodies = items.map((li, i) => {
    if (li.type !== "taskItem") return unsupported(li.type);
    const flag = li.attrs?.checked ?? false;
    if (typeof flag !== "boolean")
      throw new PdfExportError("A task item's checked value must be true or false");
    if (flag) checked.push(i + 1);
    return `  [\n${blocks(li.content, ctx)}\n  ]`;
  });
  const set = checked.length === 0 ? "()" : `(${checked.join(", ")},)`;
  return `#enum(numbering: n => task-box(n in ${set}),\n${bodies.join(",\n")},\n)`;
}

/** A definition list: each term in bold, each description indented below it. */
function definitionList(n: DocNode, ctx: Ctx): string {
  const parts = (("content" in n ? n.content : undefined) ?? []).map((k) => {
    if (k.type === "definitionTerm") return `#def-term[${inline(k.content, ctx, true)}]`;
    if (k.type === "definitionDescription") return `#def-desc[\n${blocks(k.content, ctx)}\n]`;
    return unsupported(k.type);
  });
  if (parts.length === 0) throw new PdfExportError("Definition list without entries");
  return parts.join("\n");
}

/** Rows of cells as a rectangle, or a `PdfExportError`. Cells hold paragraphs only (the editor schema guarantees it; hand-written JSON gets the error). */
function tableRows(n: DocNode): DocNode[][] {
  const rows = ("content" in n ? n.content : undefined) ?? [];
  if (rows.length === 0) throw new PdfExportError("Table without rows");
  const out = rows.map((row) => {
    if (row.type !== "tableRow") return unsupported(row.type);
    const cells = ("content" in row ? row.content : undefined) ?? [];
    for (const c of cells) {
      if (c.type !== "tableCell" && c.type !== "tableHeader") return unsupported(c.type);
      for (const k of ("content" in c ? c.content : undefined) ?? [])
        if (k.type !== "paragraph")
          throw new PdfExportError(`Unsupported node in a table cell: ${k.type}`);
    }
    return cells;
  });
  const width = out[0]!.length;
  if (width === 0 || out.some((r) => r.length !== width))
    throw new PdfExportError("Table rows must all have the same, non-zero number of cells");
  return out;
}

function tableBlock(n: DocNode, ctx: Ctx): string {
  const rows = tableRows(n);
  const cell = (c: DocNode, inHeader: boolean): string => {
    const body = blocks("content" in c ? c.content : undefined, ctx);
    return `[${c.type === "tableHeader" && !inHeader ? `#strong[${body}]` : body}]`;
  };
  const headerRow = rows[0]!.every((c) => c.type === "tableHeader");
  const lines = rows.map((r, i) => {
    const cells = r.map((c) => cell(c, headerRow && i === 0)).join(", ");
    return headerRow && i === 0 ? `  table.header(${cells}),` : `  ${cells},`;
  });
  return `#table(\n  columns: (${rows[0]!.map(() => "1fr").join(", ")}),\n${lines.join("\n")}\n)`;
}

/** A heading; with `mark` (the start mark call) the heading's text sits between it and an end mark. */
function heading(n: Exclude<DocNode, { type: "text" }>, ctx: Ctx, mark?: string): string {
  const kids = "content" in n ? n.content : undefined;
  const level = Number(n.attrs?.level ?? 1);
  if (![1, 2, 3].includes(level))
    throw new PdfExportError(
      `Heading level ${String(n.attrs?.level)} is not allowed (levels 1-3 only)`,
    );
  if (mark === undefined) return `#heading(level: ${level})[${inline(kids, ctx, true)}]`;
  return `#heading(level: ${level})[${mark}${inline(kids, ctx, true, false, { starts: [] })}]`;
}

function block(n: DocNode, ctx: Ctx): string {
  const kids = "content" in n ? n.content : undefined;
  switch (n.type) {
    case "paragraph": {
      const s = inline(kids, ctx, true);
      return s.trim() === "" ? "" : s;
    }
    case "heading":
      return heading(n, ctx);
    case "blockquote":
      return `#quote(block: true)[\n${blocks(kids, ctx)}\n]`;
    case "bulletList":
      return `#list(\n${listItems(kids, ctx)},\n)`;
    case "orderedList": {
      const start =
        typeof n.attrs?.start === "number" && Number.isInteger(n.attrs.start)
          ? `start: ${n.attrs.start}, `
          : "";
      return `#enum(${start}\n${listItems(kids, ctx)},\n)`;
    }
    case "taskList":
      return taskList(n, ctx);
    case "definitionList":
      return definitionList(n, ctx);
    case "codeBlock": {
      const text = (kids ?? [])
        .map((k) => {
          if (k.type !== "text")
            throw new PdfExportError(`Unsupported node type in code block: ${k.type}`);
          return k.text;
        })
        .join("");
      return `#raw(block: true, ${typstString(text)})`;
    }
    case "table":
      return tableBlock(n, ctx);
    case "sceneBreak":
      return "#scene-break()";
    case "image": {
      const a = n.attrs ?? {};
      const src = String(a.src ?? "");
      if (!src) throw new PdfExportError("Image without a source");
      if (ctx.assets && !(src in ctx.assets)) throw new MissingAssetError([src]);
      const path = imagePath(src, ctx);
      const alt = a.alt ? typstString(String(a.alt)) : "none";
      const img = `fit-image(${typstString(path)}, ${alt}, ${inch(ctx.maxImageIn)})`;
      const cap = a.title
        ? `, caption: [${escapeMarkup(String(a.title), { lineStart: true })}]`
        : "";
      return `#figure(${img}${cap})`;
    }
    default:
      return unsupported(n.type);
  }
}

export function blocks(nodes: DocNode[] | undefined, ctx: Ctx): string {
  return (nodes ?? [])
    .map((n) => block(n, ctx))
    .filter((s) => s !== "")
    .join("\n\n");
}

/**
 * What a marked block is, for the reader of the report to check the text it maps back to is the text that was typeset: `p` an ordinary
 * paragraph (words are marked), `q` any other paragraph, `h` a heading, `s` a scene break, `o` anything else.
 */
export type BlockMarkKind = "p" | "q" | "h" | "s" | "o";

/**
 * The inline items of a paragraph as `wordStarts` takes them, or null when the paragraph is not ordinary (a footnote, code or any other
 * inline node in it): its words cannot be told apart from the markup around them, so it is marked as one piece.
 */
export function plainItems(kids: DocNode[] | undefined): (string | null)[] | null {
  const items: (string | null)[] = [];
  for (const k of kids ?? []) {
    if (k.type === "text") {
      if ((k.marks ?? []).some((m) => m.type === "code")) return null;
      items.push(k.text);
    } else if (k.type === "hardBreak") items.push(null);
    else return null;
  }
  return items;
}

/**
 * Top-level blocks carrying page marks (`PdfOptions.blockMarks`): `#bm-s(chapter, index)` where a block starts and, for an ordinary
 * paragraph, a `#wm(w)` at each word start after the first (see `wordStarts`). `first` is the index of the first node in the document.
 * Paragraphs and headings carry their start mark inside their first line; any other block gets it as a paragraph of its own before it.
 * There is no end mark: a mark after the last line of a block at the foot of a page is moved to the next page by Typst.
 */
export function markedBlocks(
  nodes: DocNode[] | undefined,
  ctx: Ctx,
  chapter: number,
  first = 0,
): string {
  const start = (i: number, kind: BlockMarkKind): string => `#bm-s(${chapter}, ${i}, "${kind}")`;
  return (nodes ?? [])
    .map((n, k) => {
      const i = first + k;
      const kids = "content" in n ? n.content : undefined;
      if (n.type === "paragraph") {
        const items = plainItems(kids);
        const body = inline(kids, ctx, true, false, { starts: items ? wordStarts(items) : [] });
        return body.trim() === "" ? "" : `${start(i, items ? "p" : "q")}${body}`;
      }
      if (n.type === "heading") return heading(n, ctx, start(i, "h"));
      return `${start(i, n.type === "sceneBreak" ? "s" : "o")}\n\n${block(n, ctx)}`;
    })
    .filter((s) => s !== "")
    .join("\n\n");
}
