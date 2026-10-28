import type { ComponentPropsWithRef } from "react";
import { cx } from "./cx";

/** The small uppercase heading that labels a group (chapters, recent projects, details). */
export function SectionHeading({ className, ...rest }: ComponentPropsWithRef<"h2">) {
  return (
    <h2
      className={cx("text-micro font-bold uppercase tracking-[0.12em] text-ink-muted", className)}
      {...rest}
    />
  );
}
