import { useLayoutEffect, useRef } from "react";
import { resolveVerticalCenter, type Template } from "@cadabracraft/templates";
import type { MatterKind } from "@cadabracraft/shared";
import { centreOffsetPx } from "../lib/pageLayout";

/**
 * Whether a page's content sits in the vertical middle of its page: a matter page by its own choice or the template's kinds
 * (a matter page with no kind is a custom page); never a chapter. The one rule is `resolveVerticalCenter`.
 */
export function pageIsCentred(
  look: { print: Template["print"] },
  section: "front" | "chapter" | "back",
  kind: MatterKind | undefined,
  choice: { verticalCenter?: boolean | undefined },
): boolean {
  const own = choice.verticalCenter === undefined ? {} : { verticalCenter: choice.verticalCenter };
  return resolveVerticalCenter(look, section === "chapter" ? undefined : (kind ?? "custom"), own);
}

/** Kinds the PDF sets with a page layout of their own (no chapter opening: no sink, ornament or label above the heading). */
const OWN_LAYOUT_KINDS: readonly (MatterKind | undefined)[] = [
  "title-page",
  "dedication",
  "epigraph",
];

/**
 * Whether a page has no chapter opening above its first heading: the title page, dedication and epigraph (the PDF's own matter
 * layouts) and any page the author centres (the PDF sets it as a centred page too).
 */
export const pageIsBare = (centred: boolean, section: string, kind: MatterKind | undefined) =>
  centred || (section !== "chapter" && OWN_LAYOUT_KINDS.includes(kind));

/**
 * The ref of the column that holds a page's editor. While `centred`, it keeps `--page-centre-top` (see index.css) at half of the
 * free height of the text box (`textH`, at zoom 1), measured again whenever the content changes size; otherwise the property is
 * removed. The content's height does not depend on the padding that centres it, so there is no feedback loop. `again` is anything
 * else that should make it measure again (the layout key).
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
      const first = pm.firstElementChild;
      const last = pm.lastElementChild;
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
