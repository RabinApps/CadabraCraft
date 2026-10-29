import { plural } from "@lingui/core/macro";
import { useLingui } from "@lingui/react/macro";
import { PenLine, Plus, X } from "lucide-react";
import { Button, IconButton } from "../../ui/Button";
import { cx } from "../../ui/cx";
import { ProgressBar } from "../../ui/ProgressBar";
import { relativeTime } from "../../lib/relativeTime";
import type { Recent } from "../../state/recents";

const TONES = ["bg-accent-soft", "bg-success-soft", "bg-warn-soft"] as const;

/** A steady tint per book, so a cover keeps its colour while the list changes. */
const toneOf = (root: string) =>
  TONES[
    [...root].reduce((h, ch) => Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0, 2166136261) %
      TONES.length
  ];

/** The typographic cover used until books carry a cover image of their own. */
function Cover({ recent, className }: { recent: Recent; className: string }) {
  const { t } = useLingui();
  return (
    <span className={cx("flex flex-col justify-end p-4", toneOf(recent.root), className)}>
      <span className="font-book text-heading font-semibold text-ink">
        {recent.title || t`Untitled`}
      </span>
    </span>
  );
}

function useEditedLabel() {
  const { t, i18n } = useLingui();
  return (r: Recent) => {
    const when = relativeTime(r.editedAt ?? r.openedAt, Date.now(), i18n.locale);
    return r.editedAt ? t`Edited ${when}` : t`Opened ${when}`;
  };
}

/** What the card says about the book's size, when it is known. */
function useSizeLabel() {
  const { t } = useLingui();
  return (r: Recent) =>
    r.stats
      ? t`${plural(r.stats.chapters, { one: "# chapter", other: "# chapters" })} · ${plural(r.stats.words, { one: "# word", other: "# words" })}`
      : "";
}

/** The most recent book: where you left off, with a way straight back in. */
export function ContinueCard({ recent, onOpen }: { recent: Recent; onOpen: () => void }) {
  const { t } = useLingui();
  const size = useSizeLabel();
  const stats = recent.stats;
  const here = stats && stats.chapterNo > 0 ? stats : null;
  return (
    <section
      aria-label={t`Continue writing`}
      className="flex flex-col overflow-hidden rounded-lg border border-border bg-surface md:flex-row"
    >
      <Cover recent={recent} className="h-36 md:h-auto md:w-52 md:shrink-0" />
      <div className="flex min-w-0 flex-1 flex-col gap-3 p-5 md:p-7">
        <p className="text-micro font-bold uppercase tracking-[0.12em] text-accent">{t`Continue writing`}</p>
        <h2 className="font-book text-heading font-semibold">
          {here?.chapterTitle
            ? t`Chapter ${here.chapterNo} · ${here.chapterTitle}`
            : recent.title || t`Untitled`}
        </h2>
        {here && (
          <div className="flex flex-col gap-1.5 text-xs text-ink-muted md:flex-row md:items-center md:gap-3">
            <ProgressBar
              label={t`Place in the book`}
              value={here.chapterNo}
              max={here.chapters}
              className="h-1.5 w-full shrink-0 bg-border md:w-60"
            />
            <span>
              {t`${here.chapterNo} of ${plural(here.chapters, { one: "# chapter", other: "# chapters" })}`}
              {" · "}
              {plural(here.words, { one: "# word", other: "# words" })}
            </span>
          </div>
        )}
        {!here && stats && <p className="text-xs text-ink-muted">{size(recent)}</p>}
        <div>
          <Button variant="primary" icon={PenLine} onClick={onOpen} className="max-md:w-full">
            {t`Continue writing`}
          </Button>
        </div>
      </div>
    </section>
  );
}

interface BookCardProps {
  recent: Recent;
  /** Why the book could not be opened, when it failed. */
  problem?: string | undefined;
  onOpen: () => void;
  onRemove: () => void;
}

export function BookCard({ recent, problem, onOpen, onRemove }: BookCardProps) {
  const { t } = useLingui();
  const edited = useEditedLabel();
  const size = useSizeLabel();
  const stats = recent.stats;
  return (
    <li className="relative flex flex-col overflow-hidden rounded-lg border border-border bg-surface">
      <button
        type="button"
        onClick={onOpen}
        className="flex flex-col text-start hover:bg-accent-soft/40 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent"
      >
        <Cover recent={recent} className="h-36" />
        <span className="flex flex-col gap-1 p-3.5">
          {stats?.author ? (
            <span className="truncate text-sm font-semibold">{stats.author}</span>
          ) : null}
          {stats ? <span className="text-xs text-ink-muted">{size(recent)}</span> : null}
          <span className="text-xs text-ink-muted">{edited(recent)}</span>
        </span>
      </button>
      {problem && (
        <p role="alert" className="px-3.5 pb-3 text-xs text-danger">
          {problem}
        </p>
      )}
      <IconButton
        icon={X}
        label={t`Remove ${recent.title || recent.root} from recent projects`}
        onClick={onRemove}
        className="absolute inset-e-2 top-2 bg-surface/85"
      />
    </li>
  );
}

/** The last tile of the grid: the same action as the New project button, within reach of the books. */
export function NewBookTile({ onClick }: { onClick: () => void }) {
  const { t } = useLingui();
  return (
    <li className="flex">
      <button
        type="button"
        onClick={onClick}
        className="flex min-h-36 w-full flex-col items-center justify-center gap-2 rounded-lg border border-border text-sm font-semibold text-ink-muted hover:bg-accent-soft/40 hover:text-ink focus-visible:outline-2 focus-visible:outline-accent md:min-h-56"
      >
        <Plus size={22} aria-hidden />
        {t`Start a new book`}
      </button>
    </li>
  );
}
