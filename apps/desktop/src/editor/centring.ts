import { useLayoutEffect, useRef } from "react";
import { resolveVerticalCenter, type Template } from "@cadabracraft/templates";
import type { EntryKind } from "@cadabracraft/shared";
import { centreOffsetPx } from "../lib/page/pageLayout";

/**
 * Whether a page's content sits in the vertical middle of its page: a matter page by its own choice or the template's kinds
 * (a matter page with no kind is a custom page); never a chapter. The one rule is `resolveVerticalCenter`.
 */
export function pageIsCentred(
  look: { print: Template["print"] },
  section: "front" | "chapter" | "back",
  kind: EntryKind | undefined,
  choice: { verticalCenter?: boolean | undefined },
): boolean {
  // A part divider is centred between the margins and has no chapter opening, whatever the template says.
  if (kind === "part") return true;
  const own = choice.verticalCenter === undefined ? {} : { verticalCenter: choice.verticalCenter };
  return resolveVerticalCenter(look, section === "chapter" ? undefined : (kind ?? "custom"), own);
}

/** Kinds the PDF sets with a page layout of their own (no chapter opening: no sink, ornament or label above the heading). */
const OWN_LAYOUT_KINDS: readonly (EntryKind | undefined)[] = [
  "title-page",
  "dedication",
  "epigraph",
  "blank",
];

/**
 * Whether a page has no chapter opening above its first heading: the title page, dedication and epigraph (the PDF's own matter
 * layouts) and any page the author centres (the PDF sets it as a centred page too).
 */
export const pageIsBare = (centred: boolean, section: string, kind: EntryKind | undefined) =>
  centred || (section !== "chapter" && OWN_LAYOUT_KINDS.includes(kind));

/**
 * Whether the page is drawn as the PDF's centred page: a block 78 % of the text width with its lines centred (`centered-page`).
 * It follows the page's choice, not the page count, so a page that outgrows one page keeps the block and loses only the vertical
 * centring, as in the PDF. A title page is a layout of its own (full width) and is never this block.
 */
export const pageIsNarrow = (centred: boolean, section: string, kind: EntryKind | undefined) =>
  centred && (section !== "chapter" || kind === "part") && kind !== "title-page";

/**
 * Whether the page is drawn as the PDF's copyright page: the printer's imprint at the foot of the text box, in 0.85 em with 0.7 em
 * between paragraphs (`copyright-page`). No other kind has that layout, and a chapter never does.
 */
export const pageIsCopyright = (section: string, kind: EntryKind | undefined) =>
  section !== "chapter" && kind === "copyright";

/** Pages the PDF lays out without a running head at all: the title page (and its copyright page), the contents and any centred page. */
const HEADLESS_KINDS: readonly (EntryKind | undefined)[] = [
  "title-page",
  "copyright",
  "contents",
  "blank",
  "part",
];

/**
 * Whether a front or back matter page prints a running head on the pages it runs onto, as the PDF's header does: the book title on the
 * left-hand pages and the page's own title on the right-hand ones. The title page, the copyright page behind it and the contents page
 * print none (`folio-off`), and neither does a centred page (`header-off`). The page the entry opens on has none either: the PDF
 * skips the header on the page where `chapter-start` sits, and `PageStack` asks for a head only on the cards after the entry's first
 * one. A chapter heads its pages whatever these rules say.
 */
export const matterHeadsOn = (centred: boolean, section: string, kind: EntryKind | undefined) =>
  section !== "chapter" && !centred && !HEADLESS_KINDS.includes(kind);

/**
 * Whether the page is drawn centred: the author or the template centres it, and it is a single page of its own.
 *
 * The blank left-hand page the book inserts before a dedication, epigraph or title page (the layout's `blankBefore`) is a card of the
 * page's stack but not a page of the entry (see `layoutBook`), so it is not counted: a one-page dedication with a blank before it is
 * still one page and is still centred.
 */
export const centredPage = (verticalCenter: boolean, kinds: readonly string[]): boolean =>
  verticalCenter && kinds.filter((kind) => kind !== "blank").length <= 1;

/**
 * The ref of the column that holds a page's editor. While `centred`, it keeps `--page-centre-top` (see index.css) at half of the
 * free height of the text box (`textH`, at zoom 1), measured again whenever the content changes size; otherwise the property is
 * removed. The content's height does not depend on the padding that centres it, so there is no feedback loop. `again` is anything
 * else that should make it measure again (the layout key).
 *
 * The page-break spacers (`.pv-gap`) are skipped: a blank page before the entry is one of them, and it sits above the text, so
 * measuring from it would place the page's centre on the blank page.
 */
export function useCentredColumn(centred: boolean, textH: number, zoom: number, again: string) {
  const column = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = column.current;
    if (!el) return;
    if (!centred) return void el.style.removeProperty("--page-centre-top");
    const pm = el.querySelector<HTMLElement>(".ProseMirror");
    if (!pm) return;
    const place = () => {
      const content = [...pm.children].filter((el) => !el.classList.contains("pv-gap"));
      const first = content[0];
      const last = content[content.length - 1];
      if (!first || !last) return;
      const h = (last.getBoundingClientRect().bottom - first.getBoundingClientRect().top) / zoom;
      el.style.setProperty("--page-centre-top", `${centreOffsetPx(h, textH)}px`);
    };
    place();
    const ro = new ResizeObserver(place);
    ro.observe(pm);
    return () => ro.disconnect();
  }, [centred, textH, zoom, again]);
  return column;
}
