import type { DocNode } from "@cadabracraft/shared";
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

function block(n: DocNode, ctx: Ctx): string {
  const kids = "content" in n ? n.content : undefined;
  switch (n.type) {
    case "paragraph": {
      const s = inline(kids, ctx, true);
      return s.trim() === "" ? "" : s;
    }
    case "heading": {
      const level = Number(n.attrs?.level ?? 1);
      if (![1, 2, 3].includes(level))
        throw new PdfExportError(
          `Heading level ${String(n.attrs?.level)} is not allowed (levels 1-3 only)`,
        );
      return `#heading(level: ${level})[${inline(kids, ctx, true)}]`;
    }
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
