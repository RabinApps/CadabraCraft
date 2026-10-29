import { useId, type ComponentPropsWithRef } from "react";
import { cx } from "./cx";

interface TextareaProps extends ComponentPropsWithRef<"textarea"> {
  label: string;
  hint?: string;
  /** An error message shown under the field; marks it invalid and is read with it. */
  error?: string;
}

/** A multi-line text field with the same label, hint and error as `Field`. */
export function Textarea({ label, hint, error, className, id, rows = 3, ...rest }: TextareaProps) {
  const auto = useId();
  const inputId = id ?? auto;
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={inputId} className="text-xs font-semibold text-ink-muted">
        {label}
      </label>
      <textarea
        id={inputId}
        rows={rows}
        aria-invalid={error ? true : undefined}
        aria-describedby={
          [error && `${inputId}-error`, hint && `${inputId}-hint`].filter(Boolean).join(" ") ||
          undefined
        }
        className={cx(
          "w-full resize-y rounded-md border border-border-strong bg-surface px-3 py-2.5 text-sm text-ink placeholder:text-ink-muted focus-visible:outline-2 focus-visible:outline-accent",
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
