import { cx } from "./cx";

export type BadgeTone = "success" | "warn" | "danger";

const tones: Record<BadgeTone, { box: string; dot: string }> = {
  success: { box: "bg-success-soft text-success", dot: "bg-success" },
  warn: { box: "bg-warn-soft text-warn", dot: "bg-warn" },
  danger: { box: "bg-danger-soft text-danger", dot: "bg-danger" },
};

export function Badge({ tone, children }: { tone: BadgeTone; children: string }) {
  const t = tones[tone];
  return (
    <span
      className={cx(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold",
        t.box,
      )}
    >
      <span className={cx("size-2 rounded-full", t.dot)} aria-hidden />
      {children}
    </span>
  );
}
