import { useLingui } from "@lingui/react/macro";
import { plural } from "@lingui/core/macro";
import type { WritingSummary } from "@cadabracraft/shared";

/** The four figures of the History screen: today, the last seven days, this month and the streak. */
export function WritingStats({ summary }: { summary: WritingSummary }) {
  const { t } = useLingui();
  const words = (n: number) => plural(n, { one: "# word", other: "# words" });
  const days = (n: number) => plural(n, { one: "# day", other: "# days" });
  const tiles = [
    { key: "today", label: t`Today`, value: words(summary.today) },
    { key: "week", label: t`Last 7 days`, value: words(summary.last7Days) },
    { key: "month", label: t`This month`, value: words(summary.thisMonth) },
    { key: "streak", label: t`Streak`, value: days(summary.streak) },
  ];
  return (
    <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      {tiles.map((tile) => (
        <div key={tile.key} className="rounded-lg border border-border bg-surface px-3 py-2.5">
          <dt className="text-caption text-ink-muted">{tile.label}</dt>
          <dd className="mt-1 font-serif text-title tabular-nums text-ink">{tile.value}</dd>
        </div>
      ))}
    </dl>
  );
}
