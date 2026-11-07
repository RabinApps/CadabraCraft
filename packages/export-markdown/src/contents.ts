import type { ChapterDoc, DocNode } from "@cadabracraft/shared";
import {
  contentsTitle,
  type ContentsNode,
  nestContents,
  visibleTocItems,
} from "@cadabracraft/format";
import { escapeText, linkDestination } from "./escape";

/**
 * One line of the contents list: structurally a `TocItem` from `@cadabracraft/format`, so pass
 * `visibleTocItems(resolveToc(manifest, contentsEntry, language, outlines))` (`outlines[id]` = `extractOutline` of each page).
 */
export interface MarkdownContentsItem {
  kind: "page" | "heading" | "custom";
  /** The page the item is on (or, for a custom entry, points at): the `id` of a `MarkdownChapter`. */
  entryId?: string;
  /** 0 for a page, 1-3 for a heading; sets the nesting. */
  level: number;
  /** Display depth under a part divider; absent means `level` sets the nesting. */
  indent?: number;
  title: string;
  /** Headings: position among the page's headings (`OutlineItem.index` of `extractOutline`). */
  index?: number;
  /** A custom entry: `OutlineItem.index` of the heading its target points at (on `entryId`), when it is a heading. */
  targetIndex?: number;
  /** Hidden items are skipped, so a full `resolveToc` result can be passed too. */
  hidden?: boolean;
}

export interface MarkdownContents {
  items: readonly MarkdownContentsItem[];
  /**
   * Page id -> relative file name, when each page is written to its own file (`chaptersToMarkdown` strings saved one by one):
   * links become `file.md#heading`. Without it the pages are one document (`bookToMarkdown`) and links are `#heading`.
   * A page with no file here is listed as plain text.
   */
  files?: Readonly<Record<string, string>>;
}

/** The plain text of a node (text nodes joined; a heading cannot hold a line break, the export refuses one). */
function plainText(node: DocNode): string {
  if (node.type === "text") return node.text;
  return (node.content ?? []).map(plainText).join("");
}

/** Plain text of every heading of a document, in order (empty ones included, as `OutlineItem.index` counts them). */
export function headingTexts(doc: ChapterDoc): string[] {
  const out: string[] = [];
  const walk = (nodes: readonly DocNode[]) => {
    for (const n of nodes) {
      if (n.type === "text") continue;
      if (n.type === "heading") out.push(plainText(n));
      walk(n.content ?? []);
    }
  };
  walk(doc.content);
  return out;
}

/** The anchor GitHub-style renderers give a heading: lower case, punctuation removed, spaces as hyphens (duplicates get `-1`, `-2`). */
export function slugger(): (text: string) => string {
  const seen = new Map<string, number>();
  return (text) => {
    const base = text
      .normalize("NFC")
      .trim()
      .toLowerCase()
      .replace(/[^\p{L}\p{M}\p{N}\p{Pc} -]/gu, "")
      .replace(/ /g, "-");
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    return n === 0 ? base : `${base}-${n}`;
  };
}

/** A page as the list needs it: its id and the anchors of its headings, in order ("" = none). */
export interface ContentsPage {
  id: string;
  file?: string;
  anchors: string[];
  /** Headings the exporter adds in front of the page's own (the title, when the page does not start with one). */
  added: number;
}

/** The nested Markdown list for `contents` (hidden items dropped), linked to the anchors of `pages`; `""` when nothing is listed. */
export function contentsMarkdown(
  contents: MarkdownContents,
  pages: ReadonlyMap<string, ContentsPage>,
): string {
  const visible = visibleTocItems(contents.items);
  const href = (item: MarkdownContentsItem): string | undefined => {
    const page = item.entryId === undefined ? undefined : pages.get(item.entryId);
    if (page === undefined) return undefined;
    const heading =
      item.kind === "heading" ? item.index : item.kind === "custom" ? item.targetIndex : undefined;
    const at = heading !== undefined ? heading + page.added : 0;
    const slug = page.anchors[at] ?? "";
    if (contents.files === undefined) return slug === "" ? undefined : `#${slug}`;
    if (page.file === undefined) return undefined;
    return `${encodeURI(page.file)}${slug === "" ? "" : `#${slug}`}`;
  };
  const lines: string[] = [];
  const render = (nodes: ContentsNode<MarkdownContentsItem>[], depth: number) => {
    for (const { item, kids } of nodes) {
      const title = contentsTitle({ ...item, title: item.title.replace(/\s+/g, " ").trim() });
      const target = href(item);
      const label =
        target === undefined
          ? escapeText(title, true, {})
          : `[${escapeText(title, false, {})}](${linkDestination(target)})`;
      lines.push(`${"  ".repeat(depth)}- ${label}`);
      render(kids, depth + 1);
    }
  };
  render(nestContents(visible), 0);
  return lines.join("\n");
}
