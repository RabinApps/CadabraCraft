import { useId } from "react";
import { useLingui } from "@lingui/react/macro";
import { CircleCheck, CircleX } from "lucide-react";
import {
  loudnessScope,
  loudnessView,
  type LoudnessSummary,
} from "../../../lib/audio/loudnessReport";

/** The loudness report of a finished audiobook: measured values, the target and a pass or fail row in words. Matches "Audiobook / done / loudness" in the pen. */
export function AudioLoudnessCard({ loudness }: { loudness: LoudnessSummary }) {
  const { t } = useLingui();
  const headingId = useId();
  const view = loudnessView(loudness);
  return (
    <section
      aria-labelledby={headingId}
      className="flex flex-col gap-3 rounded-lg border border-border bg-bg p-4"
    >
      <h3 id={headingId} className="text-sm font-semibold">
        {t`Loudness`}
      </h3>
      <dl className="flex flex-col gap-2 text-sm">
        {view.rows.map((row) => (
          <div key={row.label} className="flex items-baseline justify-between gap-3">
            <dt className="text-ink-muted">{row.label}</dt>
            <dd className="font-semibold tabular-nums">
              <bdi>{row.value}</bdi>
            </dd>
          </div>
        ))}
        <div className="flex items-start justify-between gap-3 border-t border-border pt-2">
          <dt className="text-ink-muted">{t`Result`}</dt>
          <dd
            className={
              view.passed
                ? "flex items-center gap-1.5 font-semibold text-success"
                : "flex items-center gap-1.5 font-semibold text-danger"
            }
          >
            {view.passed ? (
              <CircleCheck size={16} aria-hidden />
            ) : (
              <CircleX size={16} aria-hidden />
            )}
            <span>{view.verdict}</span>
          </dd>
        </div>
      </dl>
      <p className="text-xs text-ink-muted">{loudnessScope(view.chapters)}</p>
      <p className="text-sm text-ink-muted">
        {t`The audio is not changed. Adjust the source to meet the target.`}
      </p>
    </section>
  );
}
