import { useLingui } from "@lingui/react/macro";
import { CornerDownRight, TriangleAlert } from "lucide-react";
import type { IndexPlace, IndexTerm } from "@cadabracraft/shared";
import { IconButton } from "../../ui/Button";
import { placeCount } from "../../lib/indexing/panelModel";

/** The first place a term is marked at, in reading order. */
const firstPlace = (x: IndexTerm): IndexPlace | undefined =>
  [...x.places, ...x.subs.flatMap((s) => s.places)].sort(
    (a, b) => a.chapterIndex - b.chapterIndex || a.order - b.order,
  )[0];

/** One term of the index panel: its name (opens the editor), how many places, a way to the first one, sub-entries and cross-references. */
export function IndexTermCard({
  term: x,
  dangling,
  hidden,
  onEdit,
  onGo,
}: {
  term: IndexTerm;
  dangling: string[];
  hidden: boolean;
  onEdit: () => void;
  onGo: (place: IndexPlace) => void;
}) {
  const { t } = useLingui();
  const place = firstPlace(x);
  return (
    <li className="flex flex-col gap-1 rounded-md bg-bg p-3">
      <div className="flex items-center gap-2">
        <button
          type="button"
          aria-label={t`Edit index entry ${x.term}`}
          onClick={onEdit}
          className="min-w-0 flex-1 truncate rounded-sm text-start font-book font-semibold focus-visible:outline-2 focus-visible:outline-accent"
        >
          {x.term}
        </button>
        <span className="shrink-0 rounded-full bg-accent-soft px-2 py-0.5 text-caption font-semibold text-accent">
          {placeCount(x)}
        </span>
        {place && (
          <IconButton
            icon={CornerDownRight}
            label={t`Go to the first place of ${x.term}`}
            onClick={() => onGo(place)}
          />
        )}
      </div>
      {hidden && <p className="text-caption text-ink-muted">{t`Left out of the book's index`}</p>}
      {x.subs.length > 0 && (
        <ul className="ms-3 text-caption text-ink-muted">
          {x.subs.map((s) => (
            <li key={s.term} className="font-book">
              {`${s.term} · ${s.places.length}`}
            </li>
          ))}
        </ul>
      )}
      {x.see.map((target) => (
        <p key={`see-${target}`} className="text-caption font-semibold text-accent">
          {t`See ${target}`}
        </p>
      ))}
      {x.seeAlso.map((target) => (
        <p key={`also-${target}`} className="text-caption font-semibold text-accent">
          {t`See also ${target}`}
        </p>
      ))}
      {dangling.map((target) => (
        <p
          key={`gone-${target}`}
          className="flex items-center gap-1 text-caption font-semibold text-warn"
        >
          <TriangleAlert size={12} aria-hidden />
          {t`“${target}” is not in the index`}
        </p>
      ))}
    </li>
  );
}
