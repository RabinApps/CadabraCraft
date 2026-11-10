import { useLingui } from "@lingui/react/macro";
import type { IndexPlace } from "@cadabracraft/shared";
import { Button } from "../../ui/Button";
import { attempt } from "../../state/attempt";
import { useProject } from "../../state/project/index";

/** Where a term is marked: each place with the page it is on and the words, and buttons to go there or take the mark away. */
export function IndexLocations({
  places,
  titles,
  onGo,
  onClose,
}: {
  places: { place: IndexPlace; sub?: string }[];
  titles: ReadonlyMap<string, string>;
  onGo: (place: IndexPlace) => void;
  onClose: () => void;
}) {
  const { t } = useLingui();
  const actions = useProject((s) => s.actions);
  return (
    <section aria-label={t`Locations`} className="flex flex-col gap-2">
      <h3 className="text-xs font-semibold text-ink-muted">{t`Locations`}</h3>
      {places.length === 0 ? (
        <p className="text-sm text-ink-muted">{t`This term only points to other terms.`}</p>
      ) : (
        <ul className="flex max-h-56 flex-col gap-1.5 overflow-y-auto">
          {places.map(({ place, sub }) => (
            <li key={place.id} className="flex items-center gap-2 rounded-md bg-bg p-2">
              <div className="min-w-0 flex-1">
                <p className="truncate text-small font-semibold">
                  {titles.get(place.chapterId) ?? place.chapterId}
                  {sub ? ` · ${sub}` : ""}
                </p>
                <p className="truncate font-book text-caption text-ink-muted">{place.snippet}</p>
              </div>
              <Button
                size="sm"
                aria-label={t`Go to ${place.snippet}`}
                onClick={() => {
                  onGo(place);
                  onClose();
                }}
              >
                {t`Go to`}
              </Button>
              <Button
                size="sm"
                aria-label={t`Remove ${place.snippet} from the index`}
                onClick={() => attempt(actions.removeIndexPlace(place.id))}
              >
                {t`Remove`}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
