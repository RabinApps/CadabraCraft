import { contentsLines, starterTitle } from "@cadabracraft/format";
import { countWords, textDirection, type ChapterDoc, type Section } from "@cadabracraft/shared";
import { blockRtf } from "./blocks";
import { RtfExportError } from "./errors";
import { checkText, fail, kidsOf } from "./helpers";
import { languageId } from "./language";
import { HEADER_DISTANCE, MARGIN, PAGE_HEIGHT, PAGE_WIDTH } from "./layout";
import { inline, para, textRuns } from "./paragraphs";
import { settleTables } from "./tables";
import { esc, illegalChar } from "./text";
import type { Ctx, RtfBook, RtfChapter, RtfOptions, Shared } from "./types";

export type { RtfBook, RtfChapter, RtfContentsItem, RtfOptions } from "./types";

/** Indent of a contents line per level, in twips (half an inch). */
const CONTENTS_INDENT = 720;
const SECTION_RANK: Record<Section, number> = { front: 0, chapter: 1, back: 2 };
const RIGHT_TO_LEFT_HINT = "Right-to-left languages are not supported in RTF export yet";

const readingOrder = (chapters: RtfChapter[]): RtfChapter[] =>
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

const PRESETS = { times: "Times New Roman", courier: "Courier New" } as const;

/** The font table entry for the `font` option: a preset, or the given family (trimmed). Font names end at `;`, so that is escaped. */
function manuscriptFont(font: string | undefined): { name: string; family: string } {
  if (font === undefined || font === "times") return { name: PRESETS.times, family: "roman" };
  if (font === "courier") return { name: PRESETS.courier, family: "modern" };
  const name = font.trim();
  if (name === "") throw new RtfExportError("The font name is empty");
  const bad = illegalChar(name);
  if (bad)
    throw new RtfExportError(
      `The font name contains the character ${bad}, which an RTF file cannot hold`,
    );
  return { name, family: "nil" };
}

const startsWithTitle = (doc: ChapterDoc): boolean => {
  const first = doc.content[0];
  return first?.type === "heading" && first.attrs?.level === 1;
};

const section = (headerText: string, restart: boolean): string =>
  `\\sectd\\sbkpage\\pgwsxn${PAGE_WIDTH}\\pghsxn${PAGE_HEIGHT}\\marglsxn${MARGIN}\\margrsxn${MARGIN}\\margtsxn${MARGIN}\\margbsxn${MARGIN}\\headery${HEADER_DISTANCE}${restart ? "\\pgnrestart\\pgnstarts1" : ""}\n{\\header\\pard\\plain\\f0\\fs24\\sl240\\slmult1\\li0\\ri0\\fi0\\qr ${headerText}\\par}\n`;

const dateGroup = (d: Date): string =>
  `{\\creatim\\yr${d.getUTCFullYear()}\\mo${d.getUTCMonth() + 1}\\dy${d.getUTCDate()}\\hr${d.getUTCHours()}\\min${d.getUTCMinutes()}}`;

/**
 * Builds an `.rtf` in standard manuscript format as a string (7-bit ASCII, every other character is written as `\uN?`):
 * US Letter, 1 inch margins, 12 pt Times New Roman (or Courier New), double spaced, 0.5 inch first-line indent, left aligned,
 * a running header "Surname / TITLE / page", a title page with the approximate word count, every chapter on a new page and
 * scene breaks as a centred "#". Footnotes are real RTF footnotes. Output is deterministic for a given input.
 * Throws `RtfExportError` (naming the page and node) on anything RTF cannot hold.
 */
export function buildRtf(book: RtfBook, chapters: RtfChapter[], options: RtfOptions = {}): string {
  const language = book.language ?? "en";
  if (textDirection(language) === "rtl") throw new RtfExportError(RIGHT_TO_LEFT_HINT);
  const bookText = (text: string, what: string) => {
    const bad = illegalChar(text);
    if (bad)
      throw new RtfExportError(
        `The ${what} contains the character ${bad}, which an RTF file cannot hold`,
      );
    return text;
  };
  const title = bookText(book.title.trim(), "book title");
  const author = bookText(book.author.trim(), "author name");
  const font = manuscriptFont(options.font);
  const s: Shared = {
    assets: options.assets ?? new Map(),
    pendingBreak: false,
    lang: languageId(language),
  };

  const pages = readingOrder(chapters);
  const countable = pages.filter((c) => (c.section ?? "chapter") === "chapter");
  const words = approximateWords(
    (countable.length ? countable : pages).reduce((sum, c) => sum + countWords(c.doc), 0),
  );

  const tctx: Ctx = { s, chapter: "", quote: 0, list: 0, inNote: false, runProps: {} };
  const body: string[] = [
    para(
      `About ${esc(words.toLocaleString("en-US"))} ${words === 1 ? "word" : "words"}`,
      { single: true, firstLine: 0, jc: "r" },
      tctx,
    ),
    para(
      title === "" ? "" : textRuns(title, ""),
      { before: 4320, after: 240, firstLine: 0, jc: "c", bold: true },
      tctx,
    ),
    para(author === "" ? "" : textRuns(`by ${author}`, ""), { firstLine: 0, jc: "c" }, tctx),
  ];

  let first = true;
  for (const c of pages) {
    const sec = c.section ?? "chapter";
    // The generated manuscript title page replaces a "title-page" matter page (which only holds the title and author).
    if (c.kind === "title-page") continue;
    const label = c.title.trim() || c.id || "(untitled page)";
    const ctx: Ctx = { s, chapter: label, quote: 0, list: 0, inNote: false, runProps: {} };
    if (!c.doc || c.doc.type !== "doc" || !Array.isArray(c.doc.content))
      fail(ctx, 'A chapter document must be an object with type "doc"');
    s.pendingBreak = !first;
    first = false;
    const titled = startsWithTitle(c.doc);
    const heading = { before: 2880, firstLine: 0, keepNext: true, outline: 0, jc: "c" } as const;
    if (!titled && sec === "chapter" && c.title.trim() !== "")
      body.push(
        para(textRuns(checkText(c.title.trim(), ctx, "The chapter title"), ""), heading, ctx),
      );
    if (
      c.kind === "contents" &&
      options.contents !== undefined &&
      !c.doc.content.some((n) => n.type === "heading")
    )
      body.push(
        para(
          textRuns(
            checkText(
              c.title.trim() || starterTitle("contents", language),
              ctx,
              "The contents title",
            ),
            "",
          ),
          heading,
          ctx,
        ),
      );
    c.doc.content.forEach((n, i) => {
      if (i === 0 && titled) {
        const runs = inline(kidsOf(n), ctx);
        if (runs !== "") body.push(para(runs, heading, ctx));
      } else body.push(...blockRtf(n, ctx));
    });
    if (c.kind === "contents" && options.contents !== undefined) {
      for (const { item, title } of contentsLines(options.contents)) {
        const line = checkText(title, ctx, "A contents entry");
        body.push(
          para(textRuns(line, ""), { firstLine: 0, left: CONTENTS_INDENT * item.level }, ctx),
        );
      }
    }
    // A page with no content still starts on its own page.
    if (s.pendingBreak) body.push(para("", {}, ctx));
    s.pendingBreak = false;
  }

  const surname = authorSurname(author);
  const headerLabel = `${surname ? `${surname} / ` : ""}${title.toUpperCase()} / `;
  const modified = options.modified ?? new Date(Date.UTC(2020, 0, 1));
  const lcid = languageId(language);
  const langDefaults = lcid === null ? "" : `\\deflang${lcid}\\deflangfe${lcid}`;
  const fonts = `{\\fonttbl{\\f0\\f${font.family}\\fcharset0 ${esc(font.name).replace(/;/g, "\\'3b")};}{\\f1\\fmodern\\fcharset0 Courier New;}}`;
  return (
    `{\\rtf1\\ansi\\ansicpg1252\\deff0\\uc1${langDefaults}\n${fonts}\n{\\colortbl;\\red5\\green99\\blue193;}\n` +
    `{\\info{\\title ${esc(title)}}{\\author ${esc(author)}}${dateGroup(modified)}{\\*\\generator CadabraCraft}}\n` +
    `\\paperw${PAGE_WIDTH}\\paperh${PAGE_HEIGHT}\\margl${MARGIN}\\margr${MARGIN}\\margt${MARGIN}\\margb${MARGIN}\\gutter0\\widowctrl\\ftnbj\\fet0\n` +
    section("", false) +
    body.slice(0, 3).join("\n") +
    "\n\\sect\n" +
    section(`${esc(headerLabel)}{\\field{\\*\\fldinst{PAGE}}{\\fldrslt 1}}`, true) +
    settleTables(body.slice(3)).join("\n") +
    "\n}\n"
  );
}
