import type { ComponentPropsWithRef } from "react";
import { cx } from "./cx";

interface ChipProps extends Omit<ComponentPropsWithRef<"button">, "type"> {
  /** Whether the option is on; sets `aria-pressed` and the accent fill. */
  pressed: boolean;
}

/** A small on/off option button, such as the Find bar's "Match case". */
export function Chip({ pressed, className, ...rest }: ChipProps) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      className={cx(
        "rounded-md border px-2.5 py-1 text-xs font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
        pressed
          ? "border-accent bg-accent-soft text-accent"
          : "border-border text-ink hover:bg-accent-soft",
        className,
      )}
      {...rest}
    />
  );
}
