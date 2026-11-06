import {
  dropLeadingPageBreak,
  isBackMatterKind,
  isFrontMatterKind,
  type ChapterDoc,
  type DocNode,
  type EntryKind,
  type Section,
} from "@cadabracraft/shared";
import { resolveVerticalCenter, type Template } from "@cadabracraft/templates";
import { typstString } from "../escape";
import { MissingAssetError, PdfExportError } from "../errors";
import type { PdfChapter } from "../types";
import { blocks, imagePath, isBlank, leafText, markedBlocks } from "./blocks";
import type { Ctx } from "./ctx";
import { inline } from "./inline";
import { em } from "./units";

function sectionOf(c: PdfChapter): Section {
  const section = c.section ?? "chapter";
  // A blank page may sit anywhere in the book, the chapters included.
  const ok =
    c.kind === undefined || c.kind === "blank" || c.kind === "part"
      ? true
      : section === "front"
        ? isFrontMatterKind(c.kind)
        : section === "back" && isBackMatterKind(c.kind);
  if (!ok)
    throw new PdfExportError(
      `Page "${c.id}": kind "${String(c.kind)}" is not allowed in the ${section} section`,
    );
  return section;
}

/**
 * A level-1 heading as the page's first block: the page's own title, above which the template's chapter opening (sink, ornament,
 * label) sits. Page view and the EPUB hang it on the same heading (`h1:first-child`).
 */
function opensWithTitle(doc: ChapterDoc): boolean {
  const first = doc.content?.[0];
  return first?.type === "heading" && Number(first.attrs?.level ?? 1) === 1;
}

/**
 * Pages that always open on a right-hand page, and the kinds after which the next page must (so the verso stays blank). The author's
 * start wins either way: `startOnNext: true` exempts the page (it follows the one before it, left-hand page or not) and
 * `startOnNext: false` puts it on a right-hand page even where the template starts chapters on any page.
 */
const ALWAYS_RECTO: readonly (EntryKind | undefined)[] = [
  "title-page",
  "contents",
  "dedication",
  "epigraph",
  "part",
];
const BLANK_VERSO_AFTER: readonly (EntryKind | undefined)[] = ["dedication", "epigraph"];

/**
 * The pages in order. Front matter is numbered in lowercase roman (title and copyright pages show no number), arabic numbering
 * restarts at 1 on a right-hand page at the first page after the front matter, and back matter continues the arabic count.
 */
/** Whether the text starts with an unmarked run that begins with a letter and has at least one more character. */
function opensWithLetter(kids: DocNode[] | undefined): boolean {
  const lead = kids?.[0];
  return lead?.type === "text" && (lead.marks?.length ?? 0) === 0 && /^\p{L}.{1,}/u.test(lead.text);
}

/** Where the drop cap goes: the index of the paragraph that takes it and that paragraph's inline nodes; null when it takes none. */
function dropCapTarget(doc: DocNode[] | undefined): { at: number; kids: DocNode[] } | null {
  // A chapter that opens with its own title heading takes the cap on the paragraph under it, where Page view and the EPUB put it
  // (`h1:first-child + p`); a chapter with no heading of its own opens on its first block.
  const at = doc?.[0]?.type === "heading" && Number(doc[0].attrs?.level ?? 1) === 1 ? 1 : 0;
  const first = doc?.[at];
  // A paragraph the author aligned has no big first letter: a drop cap hangs from the left margin of justified text.
  if (first?.type === "paragraph" && first.attrs?.textAlign) return null;
  const kids = first?.type === "paragraph" && "content" in first ? first.content : undefined;
  return opensWithLetter(kids) ? { at, kids: kids! } : null;
}

/** The blocks after the drop cap paragraph, with the first-line indent put back where the template has one. */
function dropCapTail(
  rest: DocNode[],
  ctx: Ctx,
  indentEm: number,
  chapter: number,
  firstIndex: number,
): string {
  // Typst treats the paragraph after the drop cap block as a first paragraph, so an indenting template needs its indent put back by hand;
  // a blank line the author left under the title keeps its place, so the indent goes to the first paragraph that has text.
  const emit = (nodes: DocNode[], first: number): string =>
    ctx.marks ? markedBlocks(nodes, ctx, chapter, first) : blocks(nodes, ctx);
  const indentAt =
    indentEm > 0
      ? rest.findIndex(
          (n) => n.type === "paragraph" && !isBlank("content" in n ? n.content : undefined),
        )
      : -1;
  const indent = indentAt < 0 ? "" : `#h(${em(indentEm)})`;
  const before = emit(indentAt < 0 ? rest : rest.slice(0, indentAt), firstIndex);
  const after = indentAt < 0 ? "" : emit(rest.slice(indentAt), firstIndex + indentAt);
  return [before, indent === "" ? after : `${indent}${after}`].filter((s) => s !== "").join("\n\n");
}

/** First paragraph of a chapter as a drop cap, or null when it does not start with a letter in plain text (then it is set normally). */
function dropCapOpening(
  doc: DocNode[] | undefined,
  ctx: Ctx,
  indentEm: number,
  chapter: number,
  /** How many of the page's first blocks were dropped (see `dropLeadingPageBreak`): the marks' block indices are offset by it. */
  off = 0,
): string | null {
  const target = dropCapTarget(doc);
  if (!target) return null;
  const { at, kids } = target;
  // The title heading the cap hangs under is still the chapter's first block: it is set above the cap, with the marks of block 0.
  const head =
    at === 0
      ? ""
      : `${
          ctx.marks
            ? markedBlocks(doc!.slice(0, at), ctx, chapter, off)
            : blocks(doc!.slice(0, at), ctx)
        }\n\n`;
  ctx.usesDropCap = true;
  const tail = dropCapTail(doc!.slice(at + 1), ctx, indentEm, chapter, off + at + 1);
  // The drop cap package takes the paragraph apart and sets its pieces again; the marks in it survive that (checked with real Typst).
  let cap: string;
  if (ctx.marks) {
    ctx.mark = { chapter, block: off + at, leaf: 0 };
    const { mark, body } = leafText(kids, ctx, "p");
    ctx.mark = undefined;
    cap = `${mark}\n\n#dropcap(height: 3, gap: 0.12em)[${body}]`;
  } else cap = `#dropcap(height: 3, gap: 0.12em)[${inline(kids, ctx, true)}]`;
  return `${head}${cap}${tail === "" ? "" : `\n\n${tail}`}`;
}

interface BodyState {
  chapterNo: number;
  sawFront: boolean;
  restarted: boolean;
  prev: EntryKind | undefined;
  ctx: Ctx;
  template: Pick<Template, "print">;
}

/** The page breaks (and the numbering restart) that go before a page. */
function breaksBefore(page: PdfChapter, kind: EntryKind | undefined, st: BodyState): string | null {
  const section = sectionOf(page);
  if (section === "front") st.sawFront = true;
  const restart = st.sawFront && section !== "front" && !st.restarted;
  // The numbering restart puts the first page after the front matter on a right-hand page, unless the author let that page follow
  // on: the choice wins over every rule that would push it (see `layoutBook` in @cadabracraft/shared).
  const break_ =
    restart && page.startOnNext !== true
      ? '#pagebreak(weak: true, to: "odd")'
      : "#pagebreak(weak: true)";
  if (restart) {
    st.restarted = true;
    return `${break_}\n#set page(numbering: "1")\n#counter(page).update(1)\n#mark("numbering-arabic")\n`;
  }
  if (
    page.startOnNext === false ||
    (page.startOnNext !== true &&
      (ALWAYS_RECTO.includes(kind) || BLANK_VERSO_AFTER.includes(st.prev)))
  )
    return '#pagebreak(weak: true, to: "odd")\n';
  return null;
}

/** The Typst source of one page, wrapped the way its kind needs. */
function pageSource(
  page: PdfChapter,
  kind: EntryKind | undefined,
  content: string,
  doc: ChapterDoc,
  st: BodyState,
): string {
  const title = typstString(page.title);
  const id = typstString(page.id);
  const info = `${id}, ${typstString(kind ?? "chapter")}`;
  // A page that is not centred has its content at the top of the text box; the author can centre a kind that is not by default.
  const centred = kind === "part" ? true : resolveVerticalCenter(st.template, kind, page);
  const top = centred ? "" : ", centre: false";
  // A page the author let follow on opens on the next page, left-hand or not: `chapter-start` must not push it to a right-hand one
  // (a page the author put on a right-hand page is pushed by the break above, and `chapter-start`'s own is then a no-op).
  const named = `id: ${id}, kind: ${typstString(kind ?? "chapter")}${
    page.startOnNext === true ? ", odd: false" : ""
  }`;
  switch (kind) {
    case "part":
      // A part divider is centred, unnumbered and has no running head (the template's `part-page` helper draws it).
      return `#part-page(${info})[\n${content}\n]\n`;
    case "title-page":
      return `#title-page(${info}${top})[\n${content}\n]\n`;
    case "copyright":
      return `#copyright-page(${info})[\n${content}\n]\n`;
    case "contents":
      return `#contents-page(${info}, ${st.ctx.tocEntries ?? "()"})[\n${content}\n]\n`;
    case "dedication":
    case "epigraph":
      return `#centered-page(${info}${top})[\n${content}\n]\n`;
    case undefined:
      return `#chapter-start(${title}, ${++st.chapterNo}, ${named})\n\n${content}\n\n#mark("chapter-end")\n`;
    default:
      return centred
        ? `#centered-page(${info})[\n${content}\n]\n`
        : `#chapter-start(${title}, none, ${named}${
            opensWithTitle(doc) ? "" : ", opening: false"
          })\n\n${content}\n\n#mark("chapter-end")\n`;
  }
}

/** `dropCap` is the template's choice, which a chapter's own `dropCap` overrides. */
export function bodyOf(
  pages: PdfChapter[],
  ctx: Ctx,
  dropCap: boolean,
  indentEm: number,
  template: Pick<Template, "print">,
): string {
  const out: string[] = [];
  const st: BodyState = {
    chapterNo: 0,
    sawFront: false,
    restarted: false,
    prev: undefined,
    ctx,
    template,
  };
  for (const [index, page] of pages.entries()) {
    const section = sectionOf(page);
    // A blank page keeps its kind wherever it is: a chapter's pages have none, but a blank page between two chapters is not a chapter.
    const kind = page.kind ?? (section === "chapter" ? undefined : "custom");
    // A blank page the author added is a page of its own with nothing on it: no header, no number and no text, the same page the
    // book inserts before a page that must open on a right-hand one. It follows the page before it, so it never breaks to an odd page
    // and the page after it still follows the rules (a blank page before a dedication still sees the dedication, not the blank).
    if (kind === "blank") {
      if (section === "front") st.sawFront = true;
      out.push("#page(header: none, footer: none)[]\n");
      continue;
    }
    // A break as the page's first block is at the top of the page already: kept, it would break after `#chapter-start` and leave the
    // ornament alone on an empty page. `dropped` keeps the marks' block indices in step with the editor's document.
    const { doc, dropped } = dropLeadingPageBreak(page.doc);
    const breaks = breaksBefore(page, kind, st);
    if (breaks !== null) out.push(breaks);
    st.prev = kind;
    ctx.headingKeys = ctx.tocHeadings?.get(page.id);
    ctx.headingNo = 0;
    const content =
      (kind === undefined && (page.dropCap ?? dropCap)
        ? dropCapOpening(doc.content, ctx, indentEm, index, dropped)
        : null) ??
      (ctx.marks ? markedBlocks(doc.content, ctx, index, dropped) : blocks(doc.content, ctx));
    out.push(pageSource(page, kind, content, doc, st));
  }
  return out.join("\n");
}

/**
 * The cover as a full-bleed first page (no margins, header or number). Chapters and title pages open on right-hand pages, so the cover's
 * back (the inside front cover) stays blank and the book starts on page 3. The counter is set to 0 on that blank page so that page 3 is
 * numbered 1: pages are numbered, and sit on the left or right, exactly as in a book without a cover.
 */
export function coverPage(src: string, ctx: Ctx): string {
  if (ctx.assets && !(src in ctx.assets)) throw new MissingAssetError([src]);
  const ext = /\.([A-Za-z0-9]+)$/.exec(src)?.[1]?.toLowerCase() ?? "";
  if (!["png", "jpg", "jpeg", "webp"].includes(ext))
    throw new PdfExportError(`Unsupported cover image "${src}" (use png, jpg or webp)`);
  const path = imagePath(src, ctx);
  return `#page(margin: 0pt, header: none, footer: none)[#image(${typstString(path)}, width: 100%, height: 100%, fit: "cover", alt: ${typstString(ctx.coverAlt)})]\n#page(header: none, footer: none)[#counter(page).update(0)]\n\n`;
}
