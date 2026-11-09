import { useLingui } from "@lingui/react/macro";
import type { SummaryTile } from "./analysisModel";

/** The summary row: words, sentences, Flesch reading ease, and Dale-Chall marked as pending (no word list is bundled). */
export function AnalysisSummary({ tiles }: { tiles: SummaryTile[] }) {
  const { t } = useLingui();
  return (
    <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      {tiles.map((tile) => (
        <div key={tile.key} className="rounded-lg border border-border bg-surface px-3 py-2.5">
          <dt className="text-caption text-ink-muted">{tile.label}</dt>
          <dd className="mt-1 font-serif text-title tabular-nums text-ink">{tile.value ?? "—"}</dd>
          {tile.key === "dale" && (
            <dd className="mt-1.5">
              <span className="inline-flex rounded-full bg-success-soft px-2 py-0.5 text-micro font-semibold text-success">
                {t`List pending`}
              </span>
            </dd>
          )}
        </div>
      ))}
    </dl>
  );
}
