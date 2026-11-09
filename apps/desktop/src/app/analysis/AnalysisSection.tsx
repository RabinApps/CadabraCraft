import { useId } from "react";
import { useLingui } from "@lingui/react/macro";
import type { Format, ReportSection } from "./analysisModel";

interface Props {
  section: ReportSection;
  fmt: Format;
}

/**
 * One section of the report: a heading, the number found, and a table of the items with their counts. The table has a
 * caption (the heading names it) and column headers, so a screen reader can move across a row and down a column.
 */
export function AnalysisSection({ section, fmt }: Props) {
  const { t } = useLingui();
  const id = useId();
  const { title, found, rows, empty } = section;
  return (
    <section
      aria-labelledby={`${id}-title`}
      className="rounded-lg border border-border bg-surface p-4"
    >
      <div className="flex items-baseline justify-between gap-3">
        <h3 id={`${id}-title`} className="text-body font-semibold text-ink">
          {title}
        </h3>
        <p className="text-caption text-ink-muted">
          {found === null ? t`No list yet` : t`${fmt(found)} found`}
        </p>
      </div>
      {rows.length === 0 ? (
        <p className="mt-2 text-small text-ink-muted">{empty}</p>
      ) : (
        <table className="mt-2 w-full border-collapse text-small">
          <caption className="sr-only">{title}</caption>
          <thead>
            <tr className="text-start text-caption text-ink-muted">
              <th scope="col" className="py-1 pe-3 text-start font-normal">
                {t`Item`}
              </th>
              <th scope="col" className="py-1 pe-3 text-end font-normal">
                {t`Count`}
              </th>
              <th scope="col" className="py-1 text-start font-normal">
                {t`How it counted`}
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={`${row.item}-${i}`} className="border-t border-border">
                <th scope="row" className="py-2 pe-3 text-start font-semibold text-ink">
                  {row.item}
                </th>
                <td className="py-2 pe-3 text-end tabular-nums text-ink">
                  {row.count === null ? "—" : fmt(row.count)}
                </td>
                <td className="py-2 text-caption text-ink-muted">{row.note}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
