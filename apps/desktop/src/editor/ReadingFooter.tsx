import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button, IconButton } from "../ui/Button";

interface Props {
  index: number;
  chapters: { id: string; title: string }[];
  onSelect: (id: string) => void;
}

export function ReadingFooter({ index, chapters, onSelect }: Props) {
  const prev = chapters[index - 1];
  const next = chapters[index + 1];
  const pct = chapters.length ? Math.round(((index + 1) / chapters.length) * 100) : 0;
  return (
    <footer className="flex shrink-0 items-center justify-between gap-2 border-t border-border bg-paper px-2 py-2 md:px-6">
      <div className="min-w-0 md:w-56">
        {prev && (
          <>
            <IconButton icon={ChevronLeft} label="Previous chapter" className="md:hidden" onClick={() => onSelect(prev.id)} />
            <Button variant="ghost" icon={ChevronLeft} aria-label="Previous chapter" className="max-w-full max-md:hidden" onClick={() => onSelect(prev.id)}>
              <span className="truncate">{prev.title}</span>
            </Button>
          </>
        )}
      </div>
      <div className="flex items-center gap-3 text-xs text-ink-muted">
        <div className="h-1 w-24 rounded-full bg-border md:w-60" role="progressbar" aria-label="Book progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
          <div className="h-1 rounded-full bg-accent" style={{ width: `${pct}%` }} />
        </div>
        <span>Chapter {index + 1} of {chapters.length}</span>
      </div>
      <div className="flex min-w-0 justify-end md:w-56">
        {next && (
          <>
            <IconButton icon={ChevronRight} label="Next chapter" className="md:hidden" onClick={() => onSelect(next.id)} />
            <Button variant="ghost" aria-label="Next chapter" className="max-w-full max-md:hidden" onClick={() => onSelect(next.id)}>
              <span className="truncate">{next.title}</span>
              <ChevronRight size={16} aria-hidden />
            </Button>
          </>
        )}
      </div>
    </footer>
  );
}
