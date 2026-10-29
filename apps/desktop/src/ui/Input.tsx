import { useId, type ComponentPropsWithRef } from "react";
import { cx } from "./cx";

interface FieldProps extends ComponentPropsWithRef<"input"> {
  label: string;
  hint?: string;
  /** An error message shown under the field; marks the input invalid and is read with it. */
  error?: string;
  /** Keep the label for screen readers but do not show it. */
  hideLabel?: boolean;
}

export function Field({ label, hint, error, hideLabel, className, id, ...rest }: FieldProps) {
  const auto = useId();
  const inputId = id ?? auto;
  return (
    <div className="flex flex-col gap-1.5">
      <label
        htmlFor={inputId}
        className={hideLabel ? "sr-only" : "text-xs font-semibold text-ink-muted"}
      >
        {label}
      </label>
      <input
        id={inputId}
        aria-invalid={error ? true : undefined}
        aria-describedby={
          [error && `${inputId}-error`, hint && `${inputId}-hint`].filter(Boolean).join(" ") ||
          undefined
        }
        className={cx(
          "w-full rounded-md border border-border-strong bg-surface px-3 py-2.5 text-sm max-md:min-h-11 text-ink placeholder:text-ink-muted focus-visible:outline-2 focus-visible:outline-accent read-only:text-ink-muted",
          className,
        )}
        {...rest}
      />
      {error && (
        <p id={`${inputId}-error`} className="text-xs text-danger">
          {error}
        </p>
      )}
      {hint && (
        <p id={`${inputId}-hint`} className="text-xs text-ink-muted">
          {hint}
        </p>
      )}
    </div>
  );
}
