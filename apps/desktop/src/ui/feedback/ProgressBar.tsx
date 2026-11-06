import { cx } from "../cx";

interface ProgressBarProps {
  label: string;
  value: number;
  max?: number;
  /** Size, colours and border of the track (for example `h-2 border border-border bg-bg`). */
  className?: string;
}

/** A determinate progress bar; the fill grows with `value / max`. */
export function ProgressBar({ label, value, max = 100, className }: ProgressBarProps) {
  const pct = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0;
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={value}
      className={cx("overflow-hidden rounded-full", className)}
    >
      <div
        className="h-full rounded-full bg-accent transition-[width] motion-reduce:transition-none"
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}
