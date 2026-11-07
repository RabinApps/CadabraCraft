import type { ComponentPropsWithRef } from "react";
import { CircleCheck, CircleX, Info, TriangleAlert, type LucideIcon } from "lucide-react";
import { useLingui } from "@lingui/react/macro";
import { cx } from "../cx";

export type NoticeTone = "danger" | "warn" | "success" | "accent";

const tones: Record<NoticeTone, string> = {
  danger: "bg-danger-soft text-danger",
  warn: "bg-warn-soft text-warn",
  success: "bg-success-soft text-success",
  accent: "bg-accent-soft text-accent",
};

/** Each tone has its own shape, so the kind of message is never carried by colour alone (WCAG 1.4.1). */
export const noticeIcons: Record<NoticeTone, LucideIcon> = {
  danger: CircleX,
  warn: TriangleAlert,
  success: CircleCheck,
  accent: Info,
};

interface NoticeProps extends ComponentPropsWithRef<"p"> {
  /** Defaults to `danger`. */
  tone?: NoticeTone;
  /** The smaller, semibold one-line style used for confirmations (13px). */
  strong?: boolean;
}

/** A soft-filled message box. Pass `role="alert"` for errors that appear after an action. */
export function Notice({ tone = "danger", strong, className, children, ...rest }: NoticeProps) {
  const { t } = useLingui();
  const Icon = noticeIcons[tone];
  const word = {
    danger: t`Error:`,
    warn: t`Warning:`,
    success: t`Done:`,
    accent: t`Note:`,
  }[tone];
  return (
    <p
      className={cx(
        "rounded-md px-3 py-2",
        strong ? "text-small font-semibold" : "text-sm",
        tones[tone],
        className,
      )}
      {...rest}
    >
      <Icon
        size={16}
        aria-hidden
        data-tone-icon={tone}
        className="me-2 inline-block align-text-bottom"
      />
      <span className="sr-only">{word} </span>
      {children}
    </p>
  );
}
