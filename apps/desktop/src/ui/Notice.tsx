import type { ComponentPropsWithRef } from "react";
import { cx } from "./cx";

export type NoticeTone = "danger" | "warn" | "success" | "accent";

const tones: Record<NoticeTone, string> = {
  danger: "bg-danger-soft text-danger",
  warn: "bg-warn-soft text-warn",
  success: "bg-success-soft text-success",
  accent: "bg-accent-soft text-accent",
};

interface NoticeProps extends ComponentPropsWithRef<"p"> {
  /** Defaults to `danger`. */
  tone?: NoticeTone;
  /** The smaller, semibold one-line style used for confirmations (13px). */
  strong?: boolean;
}

/** A soft-filled message box. Pass `role="alert"` for errors that appear after an action. */
export function Notice({ tone = "danger", strong, className, ...rest }: NoticeProps) {
  return (
    <p
      className={cx(
        "rounded-md px-3 py-2",
        strong ? "text-small font-semibold" : "text-sm",
        tones[tone],
        className,
      )}
      {...rest}
    />
  );
}
