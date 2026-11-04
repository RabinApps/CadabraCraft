import {
  isBackMatterKind,
  isFrontMatterKind,
  type DocNode,
  type MatterKind,
  type Section,
} from "@cadabracraft/shared";
import { resolveVerticalCenter, type Template } from "@cadabracraft/templates";
import { typstString } from "../escape";
import { MissingAssetError, PdfExportError } from "../errors";
import type { PdfChapter } from "../types";
import { blocks, imagePath, leafText, markedBlocks } from "./blocks";
import type { Ctx } from "./ctx";
import { inline } from "./inline";
import { em } from "./units";

function sectionOf(c: PdfChapter): Section {
  const section = c.section ?? "chapter";
  const ok =
    c.kind === undefined
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

/** Pages that always open on a right-hand page, and the kinds after which the next page must (so the verso stays blank). */
const ALWAYS_RECTO: readonly (MatterKind | undefined)[] = [
  "title-page",
  "contents",
  "dedication",
  "epigraph",
];
const BLANK_VERSO_AFTER: readonly (MatterKind | undefined)[] = ["dedication", "epigraph"];

/**
 * The pages in order. Front matter is numbered in lowercase roman (title and copyright pages show no number), arabic numbering
 * restarts at 1 on a right-hand page at the first page after the front matter, and back matter continues the arabic count.
 */
/** First paragraph of a chapter as a drop cap, or null when it does not start with a letter in plain text (then it is set normally). */
function dropCapOpening(
  doc: DocNode[] | undefined,
  ctx: Ctx,
  indentEm: number,
  chapter: number,
): string | null {
  const first = doc?.[0];
  // A paragraph the author aligned has no big first letter: a drop cap hangs from the left margin of justified text.
  if (first?.type === "paragraph" && first.attrs?.textAlign) return null;
  const kids = first?.type === "paragraph" && "content" in first ? first.content : undefined;
  const lead = kids?.[0];
  if (lead?.type !== "text" || (lead.marks?.length ?? 0) > 0 || !/^\p{L}.{1,}/u.test(lead.text))
    return null;
  const rest = ctx.marks
    ? markedBlocks(doc!.slice(1), ctx, chapter, 1)
    : blocks(doc!.slice(1), ctx);
  ctx.usesDropCap = true;
  // Typst treats the paragraph after the drop cap block as a first paragraph, so an indenting template needs its indent put back by hand.
  const indent = indentEm > 0 && doc![1]?.type === "paragraph" ? `#h(${em(indentEm)})` : "";
  // The drop cap package takes the paragraph apart and sets its pieces again; the marks in it survive that (checked with real Typst).
  let cap: string;
  if (ctx.marks) {
    ctx.mark = { chapter, block: 0, leaf: 0 };
    const { mark, body } = leafText(kids, ctx, "p");
    ctx.mark = undefined;
    cap = `${mark}\n\n#dropcap(height: 3, gap: 0.12em)[${body}]`;
  } else cap = `#dropcap(height: 3, gap: 0.12em)[${inline(kids, ctx, true)}]`;
  return `${cap}${rest === "" ? "" : `\n\n${indent}${rest}`}`;
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
  let chapterNo = 0;
  let sawFront = false;
  let restarted = false;
  let prev: MatterKind | undefined;
  for (const [index, page] of pages.entries()) {
    const section = sectionOf(page);
    const kind = section === "chapter" ? undefined : (page.kind ?? "custom");
    if (section === "front") sawFront = true;
    const restart = sawFront && section !== "front" && !restarted;
    if (restart) {
      restarted = true;
      out.push(
        '#pagebreak(weak: true, to: "odd")\n#set page(numbering: "1")\n#counter(page).update(1)\n#mark("numbering-arabic")\n',
      );
    } else if (ALWAYS_RECTO.includes(kind) || BLANK_VERSO_AFTER.includes(prev)) {
      out.push('#pagebreak(weak: true, to: "odd")\n');
    }
    prev = kind;
    ctx.headingKeys = ctx.tocHeadings?.get(page.id);
    ctx.headingNo = 0;
    const content =
      (kind === undefined && (page.dropCap ?? dropCap)
        ? dropCapOpening(page.doc.content, ctx, indentEm, index)
        : null) ??
      (ctx.marks ? markedBlocks(page.doc.content, ctx, index) : blocks(page.doc.content, ctx));
    const title = typstString(page.title);
    const id = typstString(page.id);
    const info = `${id}, ${typstString(kind ?? "chapter")}`;
    // A page that is not centred has its content at the top of the text box; the author can centre a kind that is not by default.
    const centred = resolveVerticalCenter(template, kind, page);
    const top = centred ? "" : ", centre: false";
    const named = `id: ${id}, kind: ${typstString(kind ?? "chapter")}`;
    switch (kind) {
      case "title-page":
        out.push(`#title-page(${info}${top})[\n${content}\n]\n`);
        break;
      case "copyright":
        out.push(`#copyright-page(${info})[\n${content}\n]\n`);
        break;
      case "contents":
        out.push(`#contents-page(${info}, ${ctx.tocEntries ?? "()"})[\n${content}\n]\n`);
        break;
      case "dedication":
      case "epigraph":
        out.push(`#centered-page(${info}${top})[\n${content}\n]\n`);
        break;
      case undefined:
        out.push(
          `#chapter-start(${title}, ${++chapterNo}, ${named})\n\n${content}\n\n#mark("chapter-end")\n`,
        );
        break;
      default:
        out.push(
          centred
            ? `#centered-page(${info})[\n${content}\n]\n`
            : `#chapter-start(${title}, none, ${named})\n\n${content}\n\n#mark("chapter-end")\n`,
        );
    }
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
