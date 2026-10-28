import { useLingui } from "@lingui/react/macro";
import { plural } from "@lingui/core/macro";
import { FileUp } from "lucide-react";
import type { ImportResult } from "@cadabracraft/import-docx";
import { Button } from "../../ui/Button";
import { groupWarnings } from "../../lib/importBook";

export function Summary({ result, kept }: { result: ImportResult; kept: number }) {
  const { t } = useLingui();
  const groups = groupWarnings(result.warnings);
  const lost = groups.filter((g) => g.severity === "warning");
  return (
    <p className="text-sm text-ink-muted" role="status">
      {plural(kept, { one: "# chapter will be imported.", other: "# chapters will be imported." })}{" "}
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
}: {
  label: string;
  value: string;
  placeholder: string;
  button: string;
  icon: typeof FileUp;
  onPick: () => void;
  hint?: string;
  disabled?: boolean;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-xs font-semibold text-ink-muted">{label}</span>
      <div className="flex gap-2">
        <input
          aria-label={label}
          readOnly
          value={value}
          placeholder={placeholder}
          className="min-w-0 flex-1 rounded-md border border-border bg-surface px-3 py-2.5 text-sm text-ink-muted placeholder:text-ink-muted"
        />
        <Button icon={icon} onClick={onPick} disabled={disabled}>
          {button}
        </Button>
      </div>
      {hint && <p className="text-xs text-ink-muted">{hint}</p>}
    </div>
  );
}
