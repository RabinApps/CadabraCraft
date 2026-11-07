import { useId, useMemo, useState } from "react";
import { useLingui } from "@lingui/react/macro";
import { ChevronDown, Lock, X } from "lucide-react";
import {
  facetsOf,
  isFiltering,
  type ColourBy,
  type FacetName,
  type FacetValue,
} from "../../lib/scenes/sceneFilter";
import type { SceneRow, SceneStatus } from "../../lib/scenes/scenes";
import { useSceneFilter } from "../../state/view/sceneFilter";
import { Button } from "../../ui/Button";
import { cx } from "../../ui/cx";
import { Field } from "../../ui/forms/Input";
import { Segmented } from "../../ui/forms/Segmented";
import { FacetMenu } from "./FacetMenu";
import { sceneStatusWord } from "./labels";

interface Props {
  /** Every scene of the book (not only the ones shown): the menus list their values and counts. */
  rows: readonly SceneRow[];
  /** How many scenes pass the filter. */
  shown: number;
  /** Say that moving scenes is off while a filter is on (the board; the timeline moves nothing). */
  moveCaption?: boolean;
}

/** One selected value as a button that removes it. */
function SelectedChip({
  facet,
  value,
  text,
  onRemove,
}: {
  facet: string;
  value: string;
  text: string;
  onRemove: () => void;
}) {
  const { t } = useLingui();
  return (
    <button
      type="button"
      data-chip={`${facet}:${value}`}
      onClick={onRemove}
      className="inline-flex items-center gap-1 rounded-full border border-accent bg-accent-soft px-2.5 py-0.5 text-micro font-semibold text-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent max-md:min-h-11"
    >
      <span>
        {facet}: {text}
      </span>
      <X size={12} aria-hidden />
      <span className="sr-only">{t`, remove this filter`}</span>
    </button>
  );
}

/**
 * The filter bar the Scene board and the Timeline share: a search field, the POV, Status and Label menus, "Colour by", the count of
 * scenes shown (announced politely when it changes) and Clear. A phone folds the controls under one Filters button. The filter is
 * only a view: nothing in the chapters changes.
 */
export function SceneFilterBar({ rows, shown, moveCaption = false }: Props) {
  const { t } = useLingui();
  const { filter, colourBy, toggle, clearFacet, setQuery, clear, setColourBy } = useSceneFilter();
  const facets = useMemo(() => facetsOf(rows), [rows]);
  const [open, setOpen] = useState(false);
  const panel = useId();
  const filtering = isFiltering(filter);
  const names: Record<FacetName, string> = { pov: t`POV`, status: t`Status`, label: t`Label` };
  const printers: Record<FacetName, (v: FacetValue) => string> = {
    pov: (v) => v.text || t`No POV`,
    status: (v) => sceneStatusWord(v.key as SceneStatus),
    label: (v) => v.text || t`No label`,
  };
  const clears: Record<FacetName, string> = {
    pov: t`Clear POV`,
    status: t`Clear status`,
    label: t`Clear label`,
  };
  const facetNames: FacetName[] = ["pov", "status", "label"];
  const selectedCount = facetNames.reduce((n, f) => n + filter[f].length, 0);
  const chips = facetNames.flatMap((f) =>
    filter[f].map((key) => {
      const known = facets[f].find((v) => v.key === key);
      // A value no scene has now (it was edited away) is still shown, so it can be removed.
      return { f, key, text: printers[f](known ?? { key, text: key, count: 0 }) };
    }),
  );
  return (
    <section
      aria-label={t`Filter scenes`}
      className="flex flex-col gap-2 border-b border-border bg-surface px-4 py-2"
    >
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={panel}
          onClick={() => setOpen(!open)}
          className="inline-flex items-center gap-1.5 rounded-md border border-border-strong px-3 py-1.5 text-xs font-semibold text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent max-md:min-h-11 md:hidden"
        >
          {t`Filters`}
          {selectedCount + (filter.query.trim() ? 1 : 0) > 0 && (
            <span className="rounded-full bg-accent px-1.5 text-micro text-accent-ink">
              {selectedCount + (filter.query.trim() ? 1 : 0)}
              <span className="sr-only"> {t`selected`}</span>
            </span>
          )}
          <ChevronDown size={14} aria-hidden className={cx(open && "rotate-180")} />
        </button>
        <div
          id={panel}
          className={cx(
            "flex flex-col gap-2 max-md:order-last max-md:w-full md:contents",
            !open && "max-md:hidden",
          )}
        >
          <div className="min-w-0 md:w-56">
            <Field
              label={t`Search scenes`}
              hideLabel
              placeholder={t`Search scenes`}
              type="search"
              value={filter.query}
              onChange={(e) => setQuery(e.target.value)}
              className="py-1.5 text-xs"
            />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {facetNames.map((f) => (
              <FacetMenu
                key={f}
                title={names[f]}
                values={facets[f]}
                selected={filter[f]}
                print={printers[f]}
                onToggle={(key) => toggle(f, key)}
                clearLabel={clears[f]}
                onClear={() => clearFacet(f)}
              />
            ))}
          </div>
          <div className="flex items-center gap-2 max-lg:basis-full">
            <span className="text-xs font-semibold text-ink-muted">{t`Colour by`}</span>
            <Segmented<ColourBy>
              label={t`Colour by`}
              value={colourBy}
              onChange={setColourBy}
              items={[
                { value: "none", label: t`None` },
                { value: "label", label: t`Label` },
                { value: "status", label: t`Status` },
              ]}
            />
          </div>
        </div>
        <p role="status" data-scene-count className="text-xs text-ink-muted md:ms-auto">
          {filtering ? t`${shown} of ${rows.length} scenes` : t`${rows.length} scenes`}
        </p>
        {filtering && (
          <Button size="sm" variant="ghost" onClick={clear} aria-label={t`Clear all filters`}>
            {t`Clear`}
          </Button>
        )}
      </div>
      {(chips.length > 0 || (moveCaption && filtering)) && (
        <div className={cx("flex flex-wrap items-center gap-2", !open && "max-md:hidden")}>
          {chips.map((c) => (
            <SelectedChip
              key={`${c.f}:${c.key}`}
              facet={names[c.f]}
              value={c.key}
              text={c.text}
              onRemove={() => toggle(c.f, c.key)}
            />
          ))}
          {moveCaption && filtering && (
            <p className="flex items-center gap-1.5 text-xs text-ink-muted">
              <Lock size={12} aria-hidden />
              {t`Moving scenes is off while a filter is on`}
            </p>
          )}
        </div>
      )}
    </section>
  );
}
