import { ChevronLeft, ChevronRight } from "lucide-react";
import { useLingui } from "@lingui/react/macro";
import { useLocale } from "../i18n/i18n";
import { dirFor } from "../i18n/locales";
import { Button, IconButton } from "../ui/Button";

interface Props {
  index: number;
  /** Every page in reading order (front matter, chapters, back matter). */
  pages: { id: string; title: string }[];
  /** Ids of the chapters among `pages`, for "Chapter n of m". */
  chapterIds: string[];
  onSelect: (id: string) => void;
}

export function ReadingFooter({ index, pages, chapterIds, onSelect }: Props) {
  const { t } = useLingui();
  // Chevrons point along the reading direction, so swap them in right-to-left languages.
  const rtl = dirFor(useLocale().locale) === "rtl";
  const PrevIcon = rtl ? ChevronRight : ChevronLeft;
  const NextIcon = rtl ? ChevronLeft : ChevronRight;
  const prev = pages[index - 1];
  const next = pages[index + 1];
  const pct = pages.length ? Math.round(((index + 1) / pages.length) * 100) : 0;
  const here = pages[index];
  const chapterNo = here ? chapterIds.indexOf(here.id) + 1 : 0;
  const prevIsChapter = prev ? chapterIds.includes(prev.id) : false;
  const nextIsChapter = next ? chapterIds.includes(next.id) : false;
  return (
    <footer className="flex shrink-0 items-center justify-between gap-2 border-t border-border bg-paper px-2 py-2 md:px-6">
      <div className="min-w-0 md:w-56">
        {prev && (
          <>
            <IconButton icon={PrevIcon} label={prevIsChapter ? t`Previous chapter` : t`Previous page`} className="md:hidden" onClick={() => onSelect(prev.id)} />
            <Button variant="ghost" icon={PrevIcon} aria-label={prevIsChapter ? t`Previous chapter` : t`Previous page`} className="max-w-full max-md:hidden" onClick={() => onSelect(prev.id)}>
              <span className="truncate">{prev.title}</span>
            </Button>
          </>
        )}
      </div>
      <div className="flex items-center gap-3 text-xs text-ink-muted">
        <div className="h-1 w-24 rounded-full bg-border md:w-60" role="progressbar" aria-label={t`Book progress`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
          <div className="h-1 rounded-full bg-accent" style={{ width: `${pct}%` }} />
        </div>
        <span>{chapterNo ? t`Chapter ${chapterNo} of ${chapterIds.length}` : here?.title}</span>
      </div>
      <div className="flex min-w-0 justify-end md:w-56">
        {next && (
          <>
            <IconButton icon={NextIcon} label={nextIsChapter ? t`Next chapter` : t`Next page`} className="md:hidden" onClick={() => onSelect(next.id)} />
            <Button variant="ghost" aria-label={nextIsChapter ? t`Next chapter` : t`Next page`} className="max-w-full max-md:hidden" onClick={() => onSelect(next.id)}>
              <span className="truncate">{next.title}</span>
              <NextIcon size={16} aria-hidden />
            </Button>
          </>
        )}
      </div>
    </footer>
  );
}
