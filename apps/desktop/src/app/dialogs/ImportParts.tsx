import { useId } from "react";
import { useLingui } from "@lingui/react/macro";
import { plural } from "@lingui/core/macro";
import { FileUp } from "lucide-react";
import type { ImportResult } from "@cadabracraft/import-docx";
import { Button } from "../../ui/Button";
import { groupWarnings } from "../../lib/import/importBook";

export function Summary({
  result,
  kept,
  scenes,
}: {
  result: ImportResult;
  kept: number;
  /** For an outline: the scenes in the chapters that will be imported. */
  scenes?: number;
}) {
  const { t } = useLingui();
  const groups = groupWarnings(result.warnings);
  const lost = groups.filter((g) => g.severity === "warning");
  return (
    <p className="text-sm text-ink-muted" role="status">
      {scenes === undefined
        ? plural(kept, {
            one: "# chapter will be imported.",
            other: "# chapters will be imported.",
          })
        : t`${plural(kept, { one: "# chapter", other: "# chapters" })} and ${plural(scenes, { one: "# scene", other: "# scenes" })} will be imported.`}{" "}
      {lost.length > 0
        ? t`Some content could not be kept: ${lost.map((g) => g.code).join(", ")}. A full report follows the import.`
        : t`Nothing was lost or changed.`}
    </p>
  );
}

export function PickRow({
  label,
  value,
  placeholder,
  button,
  icon,
  onPick,
  hint,
  disabled,
  id,
  errorId,
}: {
  label: string;
  value: string;
  placeholder: string;
  button: string;
  icon: typeof FileUp;
  onPick: () => void;
  hint?: string;
  disabled?: boolean;
  /** Lets a refused submit move focus here. */
  id?: string;
  /** The id of an error message shown elsewhere: marks the box invalid and is read with it. */
  errorId?: string;
}) {
  const auto = useId();
  const inputId = id ?? auto;
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-xs font-semibold text-ink-muted">{label}</span>
      <div className="flex gap-2">
        <input
          id={inputId}
          aria-label={label}
          aria-invalid={errorId ? true : undefined}
          aria-describedby={
            [errorId, hint && `${inputId}-hint`].filter(Boolean).join(" ") || undefined
          }
          readOnly
          value={value}
          placeholder={placeholder}
          className="min-w-0 flex-1 rounded-md border border-border-strong bg-surface px-3 py-2.5 text-sm text-ink-muted placeholder:text-ink-muted"
        />
        <Button icon={icon} onClick={onPick} disabled={disabled}>
          {button}
        </Button>
      </div>
      {hint && (
        <p id={`${inputId}-hint`} className="text-xs text-ink-muted">
          {hint}
        </p>
      )}
    </div>
  );
}
