import { useCallback, useEffect, useMemo, type CSSProperties } from "react";
import { useLingui } from "@lingui/react/macro";
import type { EditionEntry } from "@cadabracraft/format";
import { PAGE_GAP } from "./pagination/core";
import { ContentsEntries, ContentsSheets } from "../app/toc/ContentsSheets";
import { useContentsView } from "../app/toc/useContentsView";
import { dirFor } from "../i18n/locales";
import { approxPages, type PreviewLine } from "../lib/tocPreview";
import { sizes, widths, type Width } from "../state/reading";

export interface ReadingContentsProps {
  entry: EditionEntry;
  paged: boolean;
  zoom: number;
  language: string;
  size: number;
  width: Width;
  onPages: (id: string, pages: number) => void;
  /** Scroll the reader to a page, and to one of its headings when `heading` is given. */
  onOpen: (id: string, heading?: number) => void;
}

/**
 * The Contents page in Read mode: the same drawing as the editor's preview (`ContentsSheets`, from the same lines, layout and page
 * numbers as `useContentsView` gives the editor), with each entry a link that scrolls the reader there. At md and up it is the page
 * at the trim size; on a phone it is the plain list in the reading layout.
 */
export function ReadingContents({
  entry,
  paged,
  zoom,
  language,
  size,
  width,
  onPages,
  onOpen,
}: ReadingContentsProps) {
  const { t } = useLingui();
  // The reader measures the book itself when it draws pages; on a phone nothing does, and the list shows estimates.
  const view = useContentsView(entry, !paged);
  const pages = useMemo(
    () => approxPages(view.lines, view.layout, view.before),
    [view.lines, view.layout, view.before],
  );
  // The section is as tall as the page(s) it draws: tell the reader how many there are.
  useEffect(() => onPages(entry.id, pages.length), [onPages, entry.id, pages.length]);
  const open = useCallback(
    (line: PreviewLine) => line.entryId !== undefined && onOpen(line.entryId, line.heading),
    [onOpen],
  );
  const dir = dirFor(language);
  if (paged)
    return (
      <nav
        aria-label={t`Contents entries`}
        lang={language}
        dir={dir}
        data-testid="reading-contents"
        className="mx-auto flex flex-col items-center"
        style={{ gap: Math.round(PAGE_GAP * zoom) }}
      >
        <ContentsSheets
          title={view.title}
          rtl={view.rtl}
          layout={view.layout}
          pages={pages}
          serif={view.serif}
          scale={zoom}
          onOpen={open}
        />
      </nav>
    );
  const style = { "--reading-size": `${sizes[size]}rem`, maxWidth: widths[width] } as CSSProperties;
  return (
    <nav
      aria-label={t`Contents entries`}
      lang={language}
      dir={dir}
      data-testid="reading-contents"
      className="prose-manuscript prose-reading mx-auto px-6 pb-6 pt-10"
      style={style}
    >
      <h2 className="font-book mb-6 text-center text-[1.6em] font-semibold">{view.title}</h2>
      <ContentsEntries lines={view.lines} entryPx={view.layout.entryPx} onOpen={open} />
    </nav>
  );
}
