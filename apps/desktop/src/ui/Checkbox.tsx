import { useId, type InputHTMLAttributes } from "react";
import { cx } from "./cx";

interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "type"> {
  label: string;
  hint?: string;
}

export function Checkbox({ label, hint, className, id, ...rest }: CheckboxProps) {
  const auto = useId();
  const inputId = id ?? auto;
  return (
    <div className="flex items-start gap-2.5">
      <input
        id={inputId}
        type="checkbox"
        aria-describedby={hint ? `${inputId}-hint` : undefined}
        className={cx("mt-0.5 size-4 shrink-0 accent-accent focus-visible:outline-2 focus-visible:outline-accent", className)}
        {...rest}
      />
      <div className="flex flex-col gap-0.5">
        <label htmlFor={inputId} className="text-sm font-semibold text-ink">{label}</label>
        {hint && <p id={`${inputId}-hint`} className="text-xs text-ink-muted">{hint}</p>}
      </div>
    </div>
  );
}
