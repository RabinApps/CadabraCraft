import { useLingui } from "@lingui/react/macro";
import { plural } from "@lingui/core/macro";
import type { HeatCell, HeatLevel } from "@cadabracraft/shared";
import { cx } from "../../ui/cx";

const LEVEL_CLASS: Record<HeatLevel, string> = {
  0: "bg-border/60",
  1: "bg-accent-soft",
  2: "bg-accent/40",
  3: "bg-accent/70",
  4: "bg-accent",
};

/** Weekday names for the row headers, in the app's language (2026-01-04 was a Sunday). */
const weekdayNames = (locale: string): string[] => {
  const f = new Intl.DateTimeFormat(locale, { weekday: "long", timeZone: "UTC" });
  return Array.from({ length: 7 }, (_, d) => f.format(new Date(Date.UTC(2026, 0, 4 + d))));
};

/**
 * The 24-week heatmap: weeks are columns, the seven days of the week are rows (Sunday first). Each square is a labelled image
 * ("12 words on 2026-11-03") inside a table, with the scale written out below it.
 */
export function WritingHeatmap({ weeks }: { weeks: HeatCell[][] }) {
  const { t, i18n } = useLingui();
  const names = weekdayNames(i18n.locale);
  const cellName = (cell: HeatCell) =>
    plural(cell.words, {
      one: `# word on ${cell.date}`,
      other: `# words on ${cell.date}`,
    });
  const scale = [
    { level: 0 as const, text: t`None` },
    { level: 1 as const, text: t`1 to 250` },
    { level: 2 as const, text: t`251 to 500` },
    { level: 3 as const, text: t`501 to 1,000` },
    { level: 4 as const, text: t`More than 1,000` },
  ];
  return (
    <figure className="m-0 rounded-lg border border-border bg-surface px-3 py-2.5">
      <div className="overflow-x-auto">
        <table className="border-separate border-spacing-[3px]">
          <caption className="mb-2 text-start text-caption text-ink-muted">
            {t`Last 24 weeks`}
          </caption>
          <thead>
            <tr>
              <td />
              {weeks.map((week) => (
                <th key={week[0]!.date} scope="col" className="sr-only">
                  {t`Week of ${week[0]!.date}`}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {names.map((name, weekday) => (
              <tr key={name}>
                <th scope="row" className="sr-only">
                  {name}
                </th>
                {weeks.map((week) => {
                  const cell = week[weekday]!;
                  const label = cellName(cell);
                  return (
                    <td key={cell.date} className="p-0">
                      <span
                        role="img"
                        aria-label={label}
                        className={cx("block size-3 rounded-[3px]", LEVEL_CLASS[cell.level])}
                      />
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <figcaption className="mt-2 text-caption text-ink-muted">
        {t`Darker squares have more words. Each square is one day.`}
      </figcaption>
      <ul className="m-0 mt-2 flex list-none flex-wrap gap-x-4 gap-y-1 p-0 text-caption text-ink-muted">
        {scale.map((s) => (
          <li key={s.level} className="flex items-center gap-1.5">
            <span
              aria-hidden="true"
              className={cx("block size-3 rounded-[3px]", LEVEL_CLASS[s.level])}
            />
            {s.text}
          </li>
        ))}
      </ul>
    </figure>
  );
}
