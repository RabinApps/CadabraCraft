import { CircleCheck, CircleX, TriangleAlert, type LucideIcon } from "lucide-react";
import { cx } from "../cx";

export type BadgeTone = "success" | "warn" | "danger";

/** Each tone has its own shape, so the state is never carried by colour alone (WCAG 1.4.1). */
export const badgeIcons: Record<BadgeTone, LucideIcon> = {
  success: CircleCheck,
  warn: TriangleAlert,
  danger: CircleX,
};

const tones: Record<BadgeTone, string> = {
  success: "bg-success-soft text-success",
  warn: "bg-warn-soft text-warn",
  danger: "bg-danger-soft text-danger",
};

export function Badge({ tone, children }: { tone: BadgeTone; children: string }) {
  const Icon = badgeIcons[tone];
  return (
    <span
      className={cx(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold",
        tones[tone],
      )}
    >
      <Icon size={12} aria-hidden data-tone-icon={tone} />
      {children}
    </span>
  );
}
