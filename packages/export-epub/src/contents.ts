import {
  contentsTitle,
  type ContentsNode,
  nestContents,
  visibleTocItems,
} from "@cadabracraft/format";
import { esc, headingAnchor } from "./xhtml";

/**
 * One line of the in-book contents and the navigation document. This is structurally a `TocItem` from `@cadabracraft/format`:
 * pass `visibleTocItems(resolveToc(manifest, contentsEntry, language, outlines))` where `outlines[id]` is
 * `extractOutline(doc)` of each page in that language. Entries whose `entryId` is not an exported page are written as plain text.
 */
export interface ContentsItem {
  kind: "page" | "heading" | "custom";
  /** The page the item is on (or, for a custom entry, points at). */
  entryId?: string;
  /** 0 for a page, 1-3 for a heading; sets the nesting. A custom entry has the level of the item it follows. */
  level: number;
  title: string;
  /** Headings: position among the page's headings (`OutlineItem.index`), the target of the link. */
  index?: number;
  /** A custom entry: `OutlineItem.index` of the heading its target points at (on `entryId`), when it is a heading. */
  targetIndex?: number;
  /** Hidden items are skipped, so a full `resolveToc` result can be passed too. */
  hidden?: boolean;
}

/** The items to list: hidden ones are dropped. */
export const listedItems = (items: readonly ContentsItem[]): ContentsItem[] =>
  visibleTocItems(items);

/**
 * Nested `<ol>` for the items (already visible), linking to the pages in `known` (page id -> file `<id>.xhtml`).
 * An entry that links nowhere is plain text in the in-book list. In the navigation document (`nav`) EPUB 3 allows a `<span>`
 * only as the heading of a nested list, so an unlinked entry with nothing linked under it is left out there, and the result is
 * "" when nothing is left (the caller then lists the chapters instead).
 */
export function contentsList(
  items: readonly ContentsItem[],
  known: ReadonlySet<string>,
  nav = false,
): string {
  const render = (nodes: ContentsNode<ContentsItem>[]): string => {
    const lines = nodes.flatMap(({ item, kids }) => {
      const title = esc(contentsTitle(item));
      const linked = item.entryId !== undefined && known.has(item.entryId);
      const at =
        item.kind === "heading"
          ? item.index
          : item.kind === "custom"
            ? item.targetIndex
            : undefined;
      const anchor = at !== undefined ? `#${headingAnchor(at)}` : "";
      const label = linked
        ? `<a href="${item.entryId}.xhtml${anchor}">${title}</a>`
        : `<span>${title}</span>`;
      const inner = kids.length > 0 ? render(kids) : "";
      return nav && !linked && inner === "" ? [] : [`<li>${label}${inner}</li>`];
    });
    // The stylesheet removes the list markers of the in-book list, which makes WebKit drop the list role: keep it explicit.
    return lines.length > 0 ? `<ol${nav ? "" : ' role="list"'}>${lines.join("")}</ol>` : "";
  };
  return render(nestContents(items));
}
