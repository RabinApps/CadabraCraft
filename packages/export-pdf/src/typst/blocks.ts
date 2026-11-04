import { parseTextAlign, wordStarts, type DocNode } from "@cadabracraft/shared";
import { escapeMarkup, typstString } from "../escape";
import { MissingAssetError, PdfExportError } from "../errors";
import { unsupported, type Ctx } from "./ctx";
import { inline, nodeSize, type WordMarks } from "./inline";
import { inch } from "./units";

const IMAGE_EXT = new Set(["png", "jpg", "jpeg", "gif", "svg", "webp"]);

/**
 * A paragraph with no text at all: the blank line the author left. The page view and the EPUB give it the height of a line, so the PDF
 * sets it as one too (`#blank-line`), and it is no leaf of the page marks: there is no text to find there.
 */
export const isBlank = (kids: DocNode[] | undefined): boolean =>
  (kids ?? []).every((k) => k.type === "text" && k.text.trim() === "");

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
    if (k.type === "definitionTerm") {
      const { mark, body } = leafText(k.content, ctx, "p");
      return `#def-term[${mark}${body}]`;
    }
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
    const isHeader = headerRow && i === 0;
    // The header row is repeated on every page the table runs onto, and so would be its marks: it carries none.
    const mark = ctx.mark;
    if (isHeader) ctx.mark = undefined;
    const cells = r.map((c) => cell(c, isHeader)).join(", ");
    ctx.mark = mark;
    return isHeader ? `  table.header(${cells}),` : `  ${cells},`;
  });
  return `#table(\n  columns: (${rows[0]!.map(() => "1fr").join(", ")}),\n${lines.join("\n")}\n)`;
}

/**
 * The marks of a text leaf's words: before each (but the first), or, in the second run of a measure (`ctx.charMarks`), inside the words
 * that run asks for and nowhere else (that run is only about those words, and so costs about what the book does without marks).
 */
function wordMarks(kids: DocNode[] | undefined, ctx: Ctx, leaf: number): WordMarks {
  const { chapter, block } = ctx.mark!;
  const starts = wordStarts(plainItems(kids));
  if (!ctx.charMarks) return { starts, before: (w) => `#wm(${w})` };
  const words = ctx.charMarks.get(`${chapter}:${block}:${leaf}`);
  return words
    ? {
        starts,
        inside: { words, mark: (w, j) => `#cm(${chapter}, ${block}, ${leaf}, ${w}, ${j})` },
      }
    : { starts: [] };
}

/** The text of a heading or paragraph: with page marks, the start mark and the words' marks go with it (`mark` is empty when not marking). */
export function leafText(
  kids: DocNode[] | undefined,
  ctx: Ctx,
  kind: BlockMarkKind,
): { mark: string; body: string } {
  if (!ctx.mark) return { mark: "", body: inline(kids, ctx, true) };
  const leaf = ctx.mark.leaf;
  return {
    mark: startMark(ctx, kind),
    body: inline(kids, ctx, true, false, wordMarks(kids, ctx, leaf)),
  };
}

/** The alignment the author chose for a paragraph or heading (`textAlign`), null when the template decides. */
function alignOf(n: Exclude<DocNode, { type: "text" }>): "start" | "center" | "end" | null {
  const align = parseTextAlign(n.attrs?.textAlign);
  if (align === undefined)
    throw new PdfExportError(
      `Text alignment ${JSON.stringify(n.attrs?.textAlign)} is not allowed (start, center or end)`,
    );
  return align;
}

/**
 * A paragraph with the alignment the author chose, or `text` as it is when there is none (the template's own). The paragraph is set
 * in a scope of its own: aligned, with no first-line indent and not justified (justified text has no side to align to, and an indent
 * would push a centred line off centre). `start` and `end` follow the book's text direction, like CSS.
 */
function aligned(n: Exclude<DocNode, { type: "text" }>, text: string): string {
  const align = alignOf(n);
  return align === null
    ? text
    : `#[#set align(${align})\n#set par(first-line-indent: 0pt, justify: false)\n${text}]`;
}

function heading(n: Exclude<DocNode, { type: "text" }>, ctx: Ctx): string {
  const kids = "content" in n ? n.content : undefined;
  const level = Number(n.attrs?.level ?? 1);
  if (![1, 2, 3].includes(level))
    throw new PdfExportError(
      `Heading level ${String(n.attrs?.level)} is not allowed (levels 1-3 only)`,
    );
  const { mark, body } = leafText(kids, ctx, "h");
  // Same walk as `extractOutline`, so the position of a heading is the `index` of its contents item.
  const key = ctx.headingKeys?.get(ctx.headingNo);
  ctx.headingNo++;
  const toc = key === undefined ? "" : `#mark("toc-heading", info: (key: ${typstString(key)}))`;
  // The template's heading rule sets the alignment inside its own block, so a heading says what it wants through its `supplement`
  // (read by `heading-align` in the preamble; a heading is never referenced, so the supplement is free).
  const align = alignOf(n);
  const supplement = align === null ? "" : `, supplement: [ha-${align}]`;
  return `#heading(level: ${level}${supplement})[${toc}${mark}${body}]`;
}

/** The start mark of the block being marked (see `markedBlocks`): where a leaf of text, an image or a code block begins. */
const startMark = (ctx: Ctx, kind: BlockMarkKind): string => {
  const m = ctx.mark!;
  m.leaf++;
  return `#bm-s(${m.chapter}, ${m.block}, "${kind}")`;
};

/** A block that is no text (a scene break, an image, a code block) carries its start mark as a paragraph of its own before it. */
const marked = (ctx: Ctx, kind: BlockMarkKind, code: string): string =>
  ctx.mark ? `${startMark(ctx, kind)}\n\n${code}` : code;

function block(n: DocNode, ctx: Ctx): string {
  const kids = "content" in n ? n.content : undefined;
  switch (n.type) {
    case "paragraph": {
      if (isBlank(kids)) return "#blank-line()";
      const { mark, body } = leafText(kids, ctx, "p");
      return aligned(n, `${mark}${body}`);
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
      const raw = `#raw(block: true, ${typstString(text)})`;
      // Each line carries a mark of its own (the `raw.line` of Typst), so a block of code that runs onto the next page is seen.
      return marked(ctx, "k", ctx.mark ? `#[#show raw.line: bm-line\n${raw}]` : raw);
    }
    case "table":
      return tableBlock(n, ctx);
    case "sceneBreak":
      return marked(ctx, "s", "#scene-break()");
    case "image": {
      const a = n.attrs ?? {};
      const src = String(a.src ?? "");
      if (!src) throw new PdfExportError("Image without a source");
      if (ctx.assets && !(src in ctx.assets)) throw new MissingAssetError([src]);
      const path = imagePath(src, ctx);
      const alt = a.alt && !a.decorative ? typstString(String(a.alt)) : "none";
      const img = `fit-image(${typstString(path)}, ${alt}, ${inch(ctx.maxImageIn)})`;
      const cap = a.title
        ? `, caption: [${escapeMarkup(String(a.title), { lineStart: true })}]`
        : "";
      return marked(ctx, "i", `#figure(${img}${cap})`);
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
 * What a marked piece of a chapter is, for the reader of the report to check the text it maps back to is the text that was typeset:
 * `p` a paragraph or definition term (its words are marked, footnotes and code in it too, the drop cap paragraph as well), `h` a heading
 * (words marked), `s` a scene break, `i` an image, `k` a block of code (its lines are marked). Every one of them is a leaf: a block
 * that holds others (a quote, a list, a table) is marked by its leaves.
 */
export type BlockMarkKind = "p" | "h" | "s" | "i" | "k";

/**
 * The inline items of a text block as `wordStarts` takes them: a string for text, a number for a footnote (the positions it takes,
 * counted like ProseMirror's) and null for a hard break.
 */
export function plainItems(kids: DocNode[] | undefined): (string | number | null)[] {
  return (kids ?? []).map((k) =>
    k.type === "text" ? k.text : k.type === "footnote" ? nodeSize(k) : null,
  );
}

/**
 * Chapter nodes with page marks (`PdfOptions.blockMarks`): `#bm-s(chapter, index, kind)` where each leaf of the top-level block
 * `index` starts (a paragraph, heading, scene break, image or block of code; a quote, list or table has one per leaf, in document
 * order) and a `#wm(w)` before each word of a text leaf after the first (see `wordStarts`; a line of code for a block of code). `first`
 * is the index of the first node in the document. A text leaf carries its start mark inside its first line; any other leaf gets it as a
 * paragraph of its own before it. There is no end mark: a mark after the last line of a block at the foot of a page is moved to the
 * next page by Typst.
 */
export function markedBlocks(
  nodes: DocNode[] | undefined,
  ctx: Ctx,
  chapter: number,
  first = 0,
): string {
  const out = (nodes ?? []).map((n, k) => {
    ctx.mark = { chapter, block: first + k, leaf: 0 };
    return block(n, ctx);
  });
  ctx.mark = undefined;
  return out.filter((s) => s !== "").join("\n\n");
}
