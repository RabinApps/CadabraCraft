import { useId, type ReactNode, type SelectHTMLAttributes } from "react";
import { cx } from "./cx";

interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label: string;
  /** Keep the label for screen readers only, when the row already shows the name. */
  hideLabel?: boolean;
  hint?: string;
  children: ReactNode;
}

/** Native select with the same label and field styling as `Field`. */
export function Select({ label, hideLabel, hint, className, id, children, ...rest }: SelectProps) {
  const auto = useId();
  const selectId = id ?? auto;
  return (
    <div className="flex flex-col gap-1.5">
      <label
        htmlFor={selectId}
        className={cx("text-xs font-semibold text-ink-muted", hideLabel && "sr-only")}
      >
        {label}
      </label>
      <select
        id={selectId}
        aria-describedby={hint ? `${selectId}-hint` : undefined}
        className={cx(
          "w-full rounded-md border border-border-strong bg-surface px-3 py-2.5 text-sm max-md:min-h-11 text-ink focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-50",
          className,
        )}
        {...rest}
      >
        {children}
      </select>
      {hint && (
        <p id={`${selectId}-hint`} className="text-xs text-ink-muted">
          {hint}
        </p>
      )}
    </div>
  );
}
