import { strToU8, zipSync } from "fflate";
import { countWords, textDirection, type ChapterDoc, type Section } from "@cadabracraft/shared";
import { blockXml } from "./blocks";
import { NS_A, NS_PIC, NS_WP } from "./drawing";
import { DocxExportError } from "./errors";
import { fail, kidsOf, checkText } from "./helpers";
import {
  appProps,
  contentTypes,
  coreProps,
  documentRels,
  emptyHeader,
  footnotesPart,
  FONT_NAMES,
  numberingPart,
  NS_R,
  NS_W,
  PAGE,
  packageRels,
  runningHeader,
  settings,
  stylesPart,
} from "./parts";
import { inline, para, textRuns } from "./paragraphs";
import { settleTables } from "./tables";
import type { Ctx, DocxBook, DocxChapter, DocxOptions, Shared } from "./types";
import { esc, illegalXmlChar, XML_HEAD } from "./xml";

export type { DocxBook, DocxChapter, DocxOptions } from "./types";

const SECTION_RANK: Record<Section, number> = { front: 0, chapter: 1, back: 2 };
const RIGHT_TO_LEFT_HINT = "Right-to-left languages are not supported in Word export yet";

const readingOrder = (chapters: DocxChapter[]): DocxChapter[] =>
  chapters
    .map((c, i) => ({ c, i }))
    .sort(
      (a, b) =>
        SECTION_RANK[a.c.section ?? "chapter"] - SECTION_RANK[b.c.section ?? "chapter"] ||
        a.i - b.i,
    )
    .map((x) => x.c);

const SUFFIXES = new Set(["jr", "sr", "ii", "iii", "iv", "phd", "md"]);

/** Last word of the author name, ignoring a trailing generational suffix ("Jr.", "III"). Empty when there is no author. */
export function authorSurname(author: string): string {
  const words = author.split(/[\s,]+/).filter(Boolean);
  while (
    words.length > 1 &&
    SUFFIXES.has(words[words.length - 1]!.replace(/\./g, "").toLowerCase())
  )
    words.pop();
  return words[words.length - 1] ?? "";
}

/** Word count rounded to the nearest 100; below 100 the exact count is kept. */
export function approximateWords(n: number): number {
  return n < 100 ? n : Math.round(n / 100) * 100;
}

function sectPr(headerRel: string, o: { restart?: boolean; type?: boolean }): string {
  return `<w:sectPr><w:headerReference w:type="default" r:id="${headerRel}"/>${o.type ? '<w:type w:val="nextPage"/>' : ""}<w:pgSz w:w="${PAGE.width}" w:h="${PAGE.height}"/><w:pgMar w:top="${PAGE.margin}" w:right="${PAGE.margin}" w:bottom="${PAGE.margin}" w:left="${PAGE.margin}" w:header="${PAGE.header}" w:footer="${PAGE.header}" w:gutter="0"/>${o.restart ? '<w:pgNumType w:start="1"/>' : ""}<w:cols w:space="720"/></w:sectPr>`;
}

/** The Word font name for the `font` option: a preset, or the given family (trimmed, XML-escaped). */
function manuscriptFontName(font: string | undefined): string {
  if (font === undefined) return FONT_NAMES.times;
  if (font === "times" || font === "courier") return FONT_NAMES[font];
  const family = font.trim();
  if (family === "") throw new DocxExportError("The font name is empty");
  const bad = illegalXmlChar(family);
  if (bad)
    throw new DocxExportError(
      `The font name contains the character ${bad}, which a Word file cannot hold`,
    );
  return esc(family);
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
export function buildDocx(
  book: DocxBook,
  chapters: DocxChapter[],
  options: DocxOptions = {},
): Uint8Array {
  const language = book.language ?? "en";
  if (textDirection(language) === "rtl") throw new DocxExportError(RIGHT_TO_LEFT_HINT);
  const bookCtxCheck = (text: string, what: string) => {
    const bad = illegalXmlChar(text);
    if (bad)
      throw new DocxExportError(
        `The ${what} contains the character ${bad}, which a Word file cannot hold`,
      );
    return text;
  };
  const title = bookCtxCheck(book.title.trim(), "book title");
  const author = bookCtxCheck(book.author.trim(), "author name");
  const fontName = manuscriptFontName(options.font);
  const s: Shared = {
    assets: options.assets ?? new Map(),
    font: fontName,
    notes: [],
    rels: [],
    media: new Map(),
    mediaTypes: new Map(),
    links: new Map(),
    ordered: [],
    drawingId: 0,
    pendingBreak: false,
  };
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
  const words = approximateWords(
    (countable.length ? countable : pages).reduce((sum, c) => sum + countWords(c.doc), 0),
  );

  const tctx: Ctx = { s, chapter: "", quote: 0, list: 0, inNote: false, runProps: {} };
  body.push(
    para(
      `<w:r><w:t>${esc(`About ${words.toLocaleString("en-US")} ${words === 1 ? "word" : "words"}`)}</w:t></w:r>`,
      { style: "TitlePageInfo" },
      tctx,
    ),
    para(title === "" ? "" : textRuns(title, ""), { style: "Title", spaceBefore: 4320 }, tctx),
    para(
      author === "" ? "" : textRuns(`by ${author}`, ""),
      { style: "TitlePageAuthor", sect: sectPr(emptyHdr, { restart: false }) },
      tctx,
    ),
  );

  let first = true;
  for (const c of pages) {
    const section = c.section ?? "chapter";
    if (c.kind === "title-page") continue;
    const label = c.title.trim() || c.id || "(untitled page)";
    const ctx: Ctx = { s, chapter: label, quote: 0, list: 0, inNote: false, runProps: {} };
    if (!c.doc || c.doc.type !== "doc" || !Array.isArray(c.doc.content))
      fail(ctx, 'A chapter document must be an object with type "doc"');
    s.pendingBreak = !first;
    first = false;
    const titled = startsWithTitle(c.doc);
    const nodes = c.doc.content;
    if (!titled && section === "chapter" && c.title.trim() !== "") {
      body.push(
        para(
          textRuns(checkText(c.title.trim(), ctx, "The chapter title"), ""),
          { style: "Heading1", spaceBefore: 2880 },
          ctx,
        ),
      );
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
  const document = `${XML_HEAD}<w:document xmlns:w="${NS_W}" xmlns:r="${NS_R}" xmlns:wp="${NS_WP}" xmlns:a="${NS_A}" xmlns:pic="${NS_PIC}"><w:body>${settled.join("")}${sectPr(runHdr, { restart: true, type: true })}</w:body></w:document>`;

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
