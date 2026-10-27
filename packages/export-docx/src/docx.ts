import { strToU8, zipSync } from "fflate";
import { countWords, imageMediaType, isAssetPath, textDirection, type ChapterDoc, type DocNode, type Mark, type MatterKind, type Section } from "@cadabracraft/shared";
import { DocxExportError } from "./errors";
import { imageSize } from "./image";
import {
  appProps, contentTypes, coreProps, documentRels, emptyHeader, footnotesPart, FONT_NAMES, INDENT, numberingPart, NS_R, NS_W, PAGE, packageRels,
  runningHeader, settings, stylesPart, TEXT_WIDTH, type ManuscriptFont, type Rel,
} from "./parts";
import { esc, illegalXmlChar, XML_HEAD } from "./xml";

export interface DocxBook {
  title: string;
  author: string;
  /** BCP 47 code; defaults to "en". Right-to-left languages are refused. */
  language?: string;
}

export interface DocxChapter {
  id?: string;
  title: string;
  doc: ChapterDoc;
  /** Front matter, chapter (default) or back matter. Pages are written in reading order: front, chapters, back. */
  section?: Section;
  kind?: MatterKind;
}

export interface DocxOptions {
  /** Bytes of every image the chapters use, keyed by the project-relative path stored in the chapter (`assets/a.png`). */
  assets?: ReadonlyMap<string, Uint8Array>;
  /** "times" (Times New Roman 12, default) or "courier" (Courier New 12). */
  font?: ManuscriptFont;
  /** Written to the document properties. Default 2020-01-01 UTC, so output is deterministic for a given input. */
  modified?: Date;
}

const SECTION_RANK: Record<Section, number> = { front: 0, chapter: 1, back: 2 };
const NS_WP = "http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing";
const NS_A = "http://schemas.openxmlformats.org/drawingml/2006/main";
const NS_PIC = "http://schemas.openxmlformats.org/drawingml/2006/picture";
const EMU_PER_PX = 9525; // 96 dpi
const MAX_W_EMU = (TEXT_WIDTH / 1440) * 914400;
const MAX_H_EMU = ((PAGE.height - 2 * PAGE.margin) / 1440) * 914400;
const MARK_TYPES: Mark["type"][] = ["bold", "italic", "underline", "smallCaps", "strike", "code", "superscript", "subscript", "link"];
const RIGHT_TO_LEFT_HINT = "Right-to-left languages are not supported in Word export yet";

const readingOrder = (chapters: DocxChapter[]): DocxChapter[] =>
  chapters
    .map((c, i) => ({ c, i }))
    .sort((a, b) => SECTION_RANK[a.c.section ?? "chapter"] - SECTION_RANK[b.c.section ?? "chapter"] || a.i - b.i)
    .map((x) => x.c);

const SUFFIXES = new Set(["jr", "sr", "ii", "iii", "iv", "phd", "md"]);

/** Last word of the author name, ignoring a trailing generational suffix ("Jr.", "III"). Empty when there is no author. */
export function authorSurname(author: string): string {
  const words = author.split(/[\s,]+/).filter(Boolean);
  while (words.length > 1 && SUFFIXES.has(words[words.length - 1]!.replace(/\./g, "").toLowerCase())) words.pop();
  return words[words.length - 1] ?? "";
}

/** Word count rounded to the nearest 100; below 100 the exact count is kept. */
export function approximateWords(n: number): number {
  return n < 100 ? n : Math.round(n / 100) * 100;
}

interface Shared {
  assets: ReadonlyMap<string, Uint8Array>;
  font: string;
  notes: string[];
  rels: Rel[];
  media: Map<string, { name: string; rel: string }>;
  mediaTypes: Map<string, string>;
  links: Map<string, string>;
  ordered: { numId: number; start: number }[];
  drawingId: number;
  /** The next paragraph starts a new page. */
  pendingBreak: boolean;
}

interface Ctx {
  s: Shared;
  chapter: string;
  /** Block quote depth. */
  quote: number;
  /** List nesting depth (0 = not in a list). */
  list: number;
  inNote: boolean;
  runProps: RunProps;
}

interface RunProps {
  bold?: boolean;
  italic?: boolean;
}

interface ParaOpts {
  style?: string;
  numId?: number;
  ilvl?: number;
  left?: number;
  right?: number;
  firstLine?: number;
  hanging?: number;
  jc?: string;
  keepNext?: boolean;
  spaceBefore?: number;
  /** Section properties ending a section (inside the last paragraph of it). */
  sect?: string;
}

const attrsOf = (n: DocNode): Record<string, string | number | null> => ("attrs" in n && n.attrs ? n.attrs : {});
const kidsOf = (n: DocNode): DocNode[] => ("content" in n && n.content ? n.content : []);

function fail(ctx: Ctx, message: string, node?: string): never {
  throw new DocxExportError(message, { chapter: ctx.chapter, node });
}

function checkText(text: string, ctx: Ctx, what: string): string {
  const bad = illegalXmlChar(text);
  if (bad) fail(ctx, `${what} contains the character ${bad}, which a Word file cannot hold`, "text");
  return text;
}

function para(inner: string, o: ParaOpts, ctx: Ctx): string {
  const pb = ctx.s.pendingBreak;
  ctx.s.pendingBreak = false;
  const ind = o.left !== undefined || o.right !== undefined || o.firstLine !== undefined || o.hanging !== undefined
    ? `<w:ind${o.left !== undefined ? ` w:left="${o.left}"` : ""}${o.right !== undefined ? ` w:right="${o.right}"` : ""}${o.hanging !== undefined ? ` w:hanging="${o.hanging}"` : ""}${o.firstLine !== undefined ? ` w:firstLine="${o.firstLine}"` : ""}/>`
    : "";
  const ppr = `${o.style ? `<w:pStyle w:val="${o.style}"/>` : ""}${o.keepNext ? "<w:keepNext/>" : ""}${pb ? "<w:pageBreakBefore/>" : ""}${
    o.numId !== undefined ? `<w:numPr><w:ilvl w:val="${o.ilvl ?? 0}"/><w:numId w:val="${o.numId}"/></w:numPr>` : ""
  }${o.spaceBefore !== undefined ? `<w:spacing w:before="${o.spaceBefore}"/>` : ""}${ind}${o.jc ? `<w:jc w:val="${o.jc}"/>` : ""}${o.sect ?? ""}`;
  return `<w:p>${ppr ? `<w:pPr>${ppr}</w:pPr>` : ""}${inner}</w:p>`;
}

function rPr(marks: Mark[], base: RunProps, ctx: Ctx, extraStyle?: string): string {
  const types = new Set<string>();
  for (const m of marks) {
    const type = (m as { type?: unknown }).type;
    if (!MARK_TYPES.includes(type as Mark["type"])) fail(ctx, `The mark "${String(type)}" has no Word form`, String(type));
    types.add(m.type);
  }
  if (types.has("superscript") && types.has("subscript")) fail(ctx, "Text cannot be both superscript and subscript", "superscript");
  const style = extraStyle ?? (types.has("link") ? "Hyperlink" : undefined);
  const mono = FONT_NAMES.courier;
  return (
    (style ? `<w:rStyle w:val="${style}"/>` : "") +
    (types.has("code") ? `<w:rFonts w:ascii="${mono}" w:hAnsi="${mono}" w:cs="${mono}"/>` : "") +
    (types.has("bold") || base.bold ? "<w:b/><w:bCs/>" : "") +
    (types.has("italic") || base.italic ? "<w:i/><w:iCs/>" : "") +
    (types.has("smallCaps") ? "<w:smallCaps/>" : "") +
    (types.has("strike") ? "<w:strike/>" : "") +
    (types.has("underline") ? '<w:u w:val="single"/>' : "") +
    (types.has("superscript") ? '<w:vertAlign w:val="superscript"/>' : types.has("subscript") ? '<w:vertAlign w:val="subscript"/>' : "")
  );
}

/** Text with line feeds and tabs turned into Word breaks and tabs. */
function textRuns(text: string, props: string): string {
  const parts = text.split(/(\n|\t)/);
  const rp = props ? `<w:rPr>${props}</w:rPr>` : "";
  return parts
    .filter((p) => p !== "")
    .map((p) => (p === "\n" ? `<w:r>${rp}<w:br/></w:r>` : p === "\t" ? `<w:r>${rp}<w:tab/></w:r>` : `<w:r>${rp}<w:t xml:space="preserve">${esc(p)}</w:t></w:r>`))
    .join("");
}

function addRel(ctx: Ctx, type: string, target: string, external = false): string {
  const id = `rId${ctx.s.rels.length + 1}`;
  ctx.s.rels.push({ id, type, target, ...(external ? { external } : {}) });
  return id;
}

function linkRel(href: string, ctx: Ctx): string {
  let id = ctx.s.links.get(href);
  if (!id) {
    id = addRel(ctx, "hyperlink", href, true);
    ctx.s.links.set(href, id);
  }
  return id;
}

function inline(nodes: DocNode[] | undefined, ctx: Ctx): string {
  let out = "";
  for (const n of nodes ?? []) {
    const type = n.type as string;
    if (n.type === "text") {
      if (n.text === "") continue;
      checkText(n.text, ctx, "A text run");
      const marks = n.marks ?? [];
      const runs = textRuns(n.text, rPr(marks, ctx.runProps, ctx));
      const link = marks.find((m) => m.type === "link");
      if (link) {
        const href = link.attrs?.href;
        if (!href) fail(ctx, "A link without an address cannot be written", "link");
        checkText(href, ctx, "A link address");
        out += `<w:hyperlink r:id="${linkRel(href, ctx)}" w:history="1">${runs}</w:hyperlink>`;
      } else out += runs;
    } else if (n.type === "footnote") {
      if (ctx.inNote) fail(ctx, "A footnote cannot contain another footnote", "footnote");
      const id = ctx.s.notes.length + 1;
      ctx.s.notes.push(""); // reserve the id before the content is rendered
      const body = inline(kidsOf(n), { ...ctx, inNote: true });
      ctx.s.notes[id - 1] = `<w:footnote w:id="${id}"><w:p><w:pPr><w:pStyle w:val="FootnoteText"/></w:pPr><w:r><w:rPr><w:rStyle w:val="FootnoteReference"/></w:rPr><w:footnoteRef/></w:r><w:r><w:t xml:space="preserve"> </w:t></w:r>${body}</w:p></w:footnote>`;
      out += `<w:r><w:rPr><w:rStyle w:val="FootnoteReference"/></w:rPr><w:footnoteReference w:id="${id}"/></w:r>`;
    } else if (type === "hardBreak") {
      out += "<w:r><w:br/></w:r>";
    } else {
      fail(ctx, `The node "${type}" cannot be written inside a paragraph`, type);
    }
  }
  return out;
}

function drawing(src: string, alt: string, title: string, ctx: Ctx): string {
  const s = ctx.s;
  if (!isAssetPath(src)) fail(ctx, `The image source "${src}" is not a project image (assets/<file>)`, "image");
  const type = imageMediaType(src);
  if (!type) fail(ctx, `The image ${src} has an unsupported type`, "image");
  if (type === "image/svg+xml") fail(ctx, `The image ${src} is an SVG, which cannot be embedded in a Word file. Use a PNG or JPEG instead`, "image");
  const bytes = s.assets.get(src);
  if (!bytes) fail(ctx, `The image file ${src} is missing`, "image");
  const { width, height } = imageSize(bytes, type, src, ctx.chapter);
  let m = s.media.get(src);
  if (!m) {
    const ext = src.slice(src.lastIndexOf(".") + 1).toLowerCase();
    const name = `image${s.media.size + 1}.${ext}`;
    m = { name, rel: addRel(ctx, "image", `media/${name}`) };
    s.media.set(src, m);
    s.mediaTypes.set(ext, type);
  }
  let cx = width * EMU_PER_PX;
  let cy = height * EMU_PER_PX;
  const scale = Math.min(1, MAX_W_EMU / cx, MAX_H_EMU / cy);
  cx = Math.max(1, Math.round(cx * scale));
  cy = Math.max(1, Math.round(cy * scale));
  const id = ++s.drawingId;
  const descr = esc(checkText(alt || title, ctx, "An image description"));
  const fileName = esc(src.slice(src.lastIndexOf("/") + 1));
  return `<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="${id}" name="Picture ${id}" descr="${descr}"/><wp:cNvGraphicFramePr><a:graphicFrameLocks noChangeAspect="1"/></wp:cNvGraphicFramePr><a:graphic><a:graphicData uri="${NS_PIC}"><pic:pic><pic:nvPicPr><pic:cNvPr id="${id}" name="${fileName}" descr="${descr}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${m.rel}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`;
}

function tableXml(n: DocNode, ctx: Ctx): string {
  const rows = kidsOf(n);
  if (rows.length === 0) fail(ctx, "A table has no rows", "table");
  const width = kidsOf(rows[0]!).length;
  if (width === 0) fail(ctx, "A table row has no cells", "tableRow");
  const colW = Math.floor(TEXT_WIDTH / width);
  const cellCtx: Ctx = { ...ctx, quote: 0, list: 0 };
  const body = rows.map((row) => {
    if (row.type !== "tableRow") fail(ctx, `The node "${row.type}" cannot be written in a table`, row.type);
    const cells = kidsOf(row);
    if (cells.length !== width) fail(ctx, "Table rows must all have the same number of cells", "tableRow");
    const header = cells.every((c) => c.type === "tableHeader");
    const tcs = cells.map((c) => {
      if (c.type !== "tableCell" && c.type !== "tableHeader") fail(ctx, `The node "${c.type}" cannot be written in a table row`, c.type);
      const props: RunProps = c.type === "tableHeader" ? { bold: true } : {};
      const ps = kidsOf(c).map((p) => {
        if (p.type !== "paragraph") fail(ctx, `The node "${p.type}" cannot be written in a table cell`, p.type);
        return para(inline(kidsOf(p), { ...cellCtx, runProps: props }), { style: "TableText" }, cellCtx);
      });
      return `<w:tc><w:tcPr><w:tcW w:w="${colW}" w:type="dxa"/></w:tcPr>${ps.length ? ps.join("") : para("", { style: "TableText" }, cellCtx)}</w:tc>`;
    });
    return `<w:tr>${header ? "<w:trPr><w:cantSplit/><w:tblHeader/></w:trPr>" : "<w:trPr><w:cantSplit/></w:trPr>"}${tcs.join("")}</w:tr>`;
  });
  return `<w:tbl><w:tblPr><w:tblStyle w:val="TableGrid"/><w:tblW w:w="${colW * width}" w:type="dxa"/><w:tblLayout w:type="fixed"/><w:tblLook w:val="04A0" w:firstRow="1" w:lastRow="0" w:firstColumn="0" w:lastColumn="0" w:noHBand="0" w:noVBand="1"/></w:tblPr><w:tblGrid>${Array.from({ length: width }, () => `<w:gridCol w:w="${colW}"/>`).join("")}</w:tblGrid>${body.join("")}</w:tbl>`;
}

function listXml(n: DocNode, ctx: Ctx): string[] {
  const ordered = n.type === "orderedList";
  const level = ctx.list;
  if (level >= 9) fail(ctx, "Lists nested more than 9 levels deep cannot be written", n.type);
  let numId = 1;
  if (ordered) {
    const start = attrsOf(n).start;
    numId = ctx.s.ordered.length + 2;
    ctx.s.ordered.push({ numId, start: typeof start === "number" && Number.isInteger(start) && start >= 0 ? start : 1 });
  }
  const out: string[] = [];
  const base = ctx.quote * INDENT;
  for (const li of kidsOf(n)) {
    if (li.type !== "listItem") fail(ctx, `The node "${li.type}" cannot be written in a list`, li.type);
    const inner: Ctx = { ...ctx, list: level + 1 };
    const left = base + INDENT * (level + 1);
    let first = true;
    for (const c of kidsOf(li)) {
      if (c.type === "paragraph") {
        const runs = inline(kidsOf(c), inner);
        if (first) out.push(para(runs, { style: "ListParagraph", numId, ilvl: level, left, hanging: 360 }, ctx));
        else if (runs !== "") out.push(para(runs, { style: "ListParagraph", left, firstLine: 0 }, ctx));
      } else {
        if (first) out.push(para("", { style: "ListParagraph", numId, ilvl: level, left, hanging: 360 }, ctx));
        out.push(...blockXml(c, inner));
      }
      first = false;
    }
    if (first) out.push(para("", { style: "ListParagraph", numId, ilvl: level, left, hanging: 360 }, ctx));
  }
  return out;
}

function blockXml(n: DocNode, ctx: Ctx): string[] {
  const kids = kidsOf(n);
  switch (n.type) {
    case "paragraph": {
      const runs = inline(kids, ctx);
      if (runs === "") return [];
      return [ctx.quote > 0 ? para(runs, { style: "BlockQuote", left: ctx.quote * INDENT, right: INDENT, firstLine: 0 }, ctx) : para(runs, {}, ctx)];
    }
    case "heading": {
      const level = Number(n.attrs?.level ?? 1);
      if (![1, 2, 3].includes(level)) fail(ctx, `Heading level ${String(n.attrs?.level)} is not allowed (levels 1-3 only)`, "heading");
      const runs = inline(kids, ctx);
      return runs === "" ? [] : [para(runs, { style: `Heading${level}` }, ctx)];
    }
    case "blockquote":
      return kids.flatMap((c) => blockXml(c, { ...ctx, quote: ctx.quote + 1 }));
    case "bulletList":
    case "orderedList":
      return listXml(n, ctx);
    case "codeBlock": {
      const text = kids
        .map((k) => {
          if (k.type !== "text") fail(ctx, `The node "${k.type}" cannot be written in a code block`, k.type);
          return checkText(k.text, ctx, "A code block");
        })
        .join("");
      const left = ctx.quote * INDENT;
      return text.split("\n").map((line) => para(line === "" ? "" : `<w:r><w:t xml:space="preserve">${esc(line)}</w:t></w:r>`, { style: "CodeBlock", ...(left ? { left, firstLine: 0 } : {}) }, ctx));
    }
    case "sceneBreak":
      return [para("<w:r><w:t>#</w:t></w:r>", { style: "SceneBreak" }, ctx)];
    case "image": {
      const a = attrsOf(n);
      const alt = String(a.alt ?? "");
      const title = String(a.title ?? "");
      const out = [para(drawing(String(a.src ?? ""), alt, title, ctx), { style: "Figure", keepNext: title !== "" }, ctx)];
      if (title) out.push(para(textRuns(checkText(title, ctx, "An image caption"), ""), { style: "Caption" }, ctx));
      return out;
    }
    case "figcaption": {
      const runs = inline(kids, ctx);
      return runs === "" ? [] : [para(runs, { style: "Caption" }, ctx)];
    }
    case "table": {
      const lead = ctx.s.pendingBreak ? [para("", {}, ctx)] : [];
      return [...lead, tableXml(n, ctx), "<!--after-table-->"];
    }
    default:
      return fail(ctx, `The node "${n.type}" cannot be written to a Word file`, n.type);
  }
}

/** Table markers become an empty paragraph where a table would touch another table or the end of the body (Word merges adjacent tables). */
function settleTables(parts: string[]): string[] {
  const out: string[] = [];
  parts.forEach((p, i) => {
    if (p !== "<!--after-table-->") { out.push(p); return; }
    const next = parts[i + 1];
    if (next === undefined || next.startsWith("<w:tbl>")) out.push('<w:p><w:pPr><w:pStyle w:val="TableText"/></w:pPr></w:p>');
  });
  return out;
}

function sectPr(headerRel: string, o: { restart?: boolean; type?: boolean }): string {
  return `<w:sectPr><w:headerReference w:type="default" r:id="${headerRel}"/>${o.type ? '<w:type w:val="nextPage"/>' : ""}<w:pgSz w:w="${PAGE.width}" w:h="${PAGE.height}"/><w:pgMar w:top="${PAGE.margin}" w:right="${PAGE.margin}" w:bottom="${PAGE.margin}" w:left="${PAGE.margin}" w:header="${PAGE.header}" w:footer="${PAGE.header}" w:gutter="0"/>${o.restart ? '<w:pgNumType w:start="1"/>' : ""}<w:cols w:space="720"/></w:sectPr>`;
}

const startsWithTitle = (doc: ChapterDoc): boolean => {
  const first = doc.content[0];
  return first?.type === "heading" && first.attrs?.level === 1;
};

/**
 * Builds a `.docx` in standard manuscript format as bytes: US Letter, 1 inch margins, 12 pt Times New Roman (or Courier New),
 * double spaced, 0.5 inch first-line indent, left aligned, a running header "Surname / TITLE / page", a title page with the
 * approximate word count, every chapter on a new page and scene breaks as a centred "#". Footnotes are real Word footnotes.
 * Output is deterministic for a given input. Throws `DocxExportError` (naming the page and node) on anything Word cannot hold.
 */
export function buildDocx(book: DocxBook, chapters: DocxChapter[], options: DocxOptions = {}): Uint8Array {
  const language = book.language ?? "en";
  if (textDirection(language) === "rtl") throw new DocxExportError(RIGHT_TO_LEFT_HINT);
  const bookCtxCheck = (text: string, what: string) => {
    const bad = illegalXmlChar(text);
    if (bad) throw new DocxExportError(`The ${what} contains the character ${bad}, which a Word file cannot hold`);
    return text;
  };
  const title = bookCtxCheck(book.title.trim(), "book title");
  const author = bookCtxCheck(book.author.trim(), "author name");
  const fontName = FONT_NAMES[options.font ?? "times"];
  const s: Shared = { assets: options.assets ?? new Map(), font: fontName, notes: [], rels: [], media: new Map(), mediaTypes: new Map(), links: new Map(), ordered: [], drawingId: 0, pendingBreak: false };
  const rel = (type: string, target: string): string => {
    const id = `rId${s.rels.length + 1}`;
    s.rels.push({ id, type, target });
    return id;
  };
  rel("styles", "styles.xml");
  rel("settings", "settings.xml");
  rel("numbering", "numbering.xml");
  rel("footnotes", "footnotes.xml");
  const emptyHdr = rel("header", "header1.xml");
  const runHdr = rel("header", "header2.xml");

  const pages = readingOrder(chapters);
  // The generated manuscript title page replaces a "title-page" matter page (which only holds the title and author).
  const body: string[] = [];
  const countable = pages.filter((c) => (c.section ?? "chapter") === "chapter");
  const words = approximateWords((countable.length ? countable : pages).reduce((sum, c) => sum + countWords(c.doc), 0));

  const tctx: Ctx = { s, chapter: "", quote: 0, list: 0, inNote: false, runProps: {} };
  body.push(
    para(`<w:r><w:t>${esc(`About ${words.toLocaleString("en-US")} ${words === 1 ? "word" : "words"}`)}</w:t></w:r>`, { style: "TitlePageInfo" }, tctx),
    para(title === "" ? "" : textRuns(title, ""), { style: "Title", spaceBefore: 4320 }, tctx),
    para(author === "" ? "" : textRuns(`by ${author}`, ""), { style: "TitlePageAuthor", sect: sectPr(emptyHdr, { restart: false }) }, tctx),
  );

  let first = true;
  for (const c of pages) {
    const section = c.section ?? "chapter";
    if (c.kind === "title-page") continue;
    const label = c.title.trim() || c.id || "(untitled page)";
    const ctx: Ctx = { s, chapter: label, quote: 0, list: 0, inNote: false, runProps: {} };
    if (!c.doc || c.doc.type !== "doc" || !Array.isArray(c.doc.content)) fail(ctx, 'A chapter document must be an object with type "doc"');
    s.pendingBreak = !first;
    first = false;
    const titled = startsWithTitle(c.doc);
    const nodes = c.doc.content;
    if (!titled && section === "chapter" && c.title.trim() !== "") {
      body.push(para(textRuns(checkText(c.title.trim(), ctx, "The chapter title"), ""), { style: "Heading1", spaceBefore: 2880 }, ctx));
    }
    nodes.forEach((n, i) => {
      if (i === 0 && titled) {
        const runs = inline(kidsOf(n), ctx);
        if (runs !== "") body.push(para(runs, { style: "Heading1", spaceBefore: 2880 }, ctx));
      } else body.push(...blockXml(n, ctx));
    });
    // A page with no content still starts on its own page.
    if (s.pendingBreak) body.push(para("", {}, ctx));
    s.pendingBreak = false;
  }
  const settled = settleTables(body);
  const last = settled[settled.length - 1] ?? "";
  const tail = last.startsWith("<w:tbl>") ? ['<w:p/>'] : [];
  const document = `${XML_HEAD}<w:document xmlns:w="${NS_W}" xmlns:r="${NS_R}" xmlns:wp="${NS_WP}" xmlns:a="${NS_A}" xmlns:pic="${NS_PIC}"><w:body>${settled.join("")}${tail.join("")}${sectPr(runHdr, { restart: true, type: true })}</w:body></w:document>`;

  const orderedNums = s.ordered;
  const surname = authorSurname(author);
  const headerLabel = `${surname ? `${surname} / ` : ""}${title.toUpperCase()} / `;
  const modified = options.modified ?? new Date(Date.UTC(2020, 0, 1));

  const files: Record<string, Uint8Array> = {};
  files["[Content_Types].xml"] = strToU8(contentTypes(s.mediaTypes));
  files["_rels/.rels"] = strToU8(packageRels());
  files["docProps/core.xml"] = strToU8(coreProps(title, author, language, modified));
  files["docProps/app.xml"] = strToU8(appProps());
  files["word/document.xml"] = strToU8(document);
  files["word/_rels/document.xml.rels"] = strToU8(documentRels(s.rels));
  files["word/styles.xml"] = strToU8(stylesPart(fontName, language));
  files["word/settings.xml"] = strToU8(settings());
  files["word/numbering.xml"] = strToU8(numberingPart(fontName, orderedNums));
  files["word/footnotes.xml"] = strToU8(footnotesPart(s.notes));
  files["word/header1.xml"] = strToU8(emptyHeader());
  files["word/header2.xml"] = strToU8(runningHeader(headerLabel));
  for (const [src, m] of s.media) files[`word/media/${m.name}`] = s.assets.get(src)!;
  return zipSync(files, { mtime: new Date(Date.UTC(2020, 0, 1)) });
}
