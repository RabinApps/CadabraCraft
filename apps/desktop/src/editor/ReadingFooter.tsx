import { ChevronLeft, ChevronRight } from "lucide-react";
import { useLingui } from "@lingui/react/macro";
import { PageZoomSelect } from "../app/shell/PageZoomSelect";
import { useIsMd } from "../app/hooks/usePageView";
import { dirFor } from "../i18n/locales";
import { useSettings } from "../state/editorPrefs";
import { readingPaged } from "../state/pageView";
import { Button, IconButton } from "../ui/Button";
import { ProgressBar } from "../ui/ProgressBar";

interface Props {
  /** The page at the reading line (its position in `pages`). */
  index: number;
  /** The page number printed at the reading line when the book is drawn as pages, else null. */
  page?: number | null;
  /** Every page in reading order (front matter, chapters, back matter). */
  pages: { id: string; title: string }[];
  /** Ids of the chapters among `pages`, for "Chapter n of m". */
  chapterIds: string[];
  onSelect: (id: string) => void;
  /** Language of the book being read: it sets the reading direction, whatever the app's own language is. */
  language: string;
}

export function ReadingFooter({ index, page, pages, chapterIds, onSelect, language }: Props) {
  const { t } = useLingui();
  const zoom = useSettings((s) => s.pageZoom);
  const set = useSettings((s) => s.set);
  // The zoom is the page zoom of Write mode: it only means something while the book is drawn as pages (not on a phone).
  const paged = readingPaged("read", useIsMd());
  // The footer lays out in the book's direction (the app's own may differ): previous sits at the start and the chevrons mirror with it.
  const prev = pages[index - 1];
  const next = pages[index + 1];
  const pct = pages.length ? Math.round(((index + 1) / pages.length) * 100) : 0;
  const here = pages[index];
  const chapterNo = here ? chapterIds.indexOf(here.id) + 1 : 0;
  const prevIsChapter = prev ? chapterIds.includes(prev.id) : false;
  const nextIsChapter = next ? chapterIds.includes(next.id) : false;
  return (
    <footer
      dir={dirFor(language)}
      className="flex shrink-0 items-center justify-between gap-2 border-t border-border bg-paper px-2 py-2 md:px-6"
    >
      <div className="min-w-0 md:w-36 lg:w-56">
        {prev && (
          <>
            <IconButton
              icon={ChevronLeft}
              label={prevIsChapter ? t`Previous chapter` : t`Previous page`}
              className="md:hidden"
              onClick={() => onSelect(prev.id)}
            />
            <Button
              variant="ghost"
              icon={ChevronLeft}
              aria-label={
                prevIsChapter ? t`Previous chapter: ${prev.title}` : t`Previous page: ${prev.title}`
              }
              className="max-w-full max-md:hidden"
              onClick={() => onSelect(prev.id)}
            >
              <span className="truncate">{prev.title}</span>
            </Button>
          </>
        )}
      </div>
      <div className="flex items-center gap-3 text-xs text-ink-muted">
        <ProgressBar label={t`Book progress`} value={pct} className="h-1 w-24 bg-border lg:w-60" />
        <span className="whitespace-nowrap">
          {chapterNo ? t`Chapter ${chapterNo} of ${chapterIds.length}` : here?.title}
          {page ? ` · ${t`Page ${page}`}` : ""}
        </span>
        {paged && <PageZoomSelect zoom={zoom} onChange={(pageZoom) => set({ pageZoom })} />}
      </div>
      <div className="flex min-w-0 justify-end md:w-36 lg:w-56">
        {next && (
          <>
            <IconButton
              icon={ChevronRight}
              label={nextIsChapter ? t`Next chapter` : t`Next page`}
              className="md:hidden"
              onClick={() => onSelect(next.id)}
            />
            <Button
              variant="ghost"
              aria-label={
                nextIsChapter ? t`Next chapter: ${next.title}` : t`Next page: ${next.title}`
              }
              className="max-w-full max-md:hidden"
              onClick={() => onSelect(next.id)}
            >
              <span className="truncate">{next.title}</span>
              <ChevronRight size={16} aria-hidden className="rtl:-scale-x-100" />
            </Button>
          </>
        )}
      </div>
    </footer>
  );
}
