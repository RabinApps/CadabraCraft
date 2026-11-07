import { useLingui } from "@lingui/react/macro";
import { Select } from "../../../ui/forms/Select";
import type { Manifest } from "@cadabracraft/format";
import { destinationOptions } from "../../../lib/import/importDestination";

/** The value of the "At the end of the book" choice (an entry id never looks like this). */
export const AT_END = "";

/**
 * "Add the chapters": where in the open book the imported chapters go. After a chapter puts them right behind it; at
 * the start of a part (right after its divider) or after a chapter inside a part puts them in that part, because a part is
 * everything up to the next part's divider.
 */
export function ImportDestination({
  manifest,
  value,
  disabled,
  onChange,
}: {
  manifest: Manifest | null;
  value: string;
  disabled?: boolean;
  onChange: (value: string) => void;
}) {
  const { t } = useLingui();
  if (!manifest) return null;
  const options = destinationOptions(manifest);
  return (
    <Select
      label={t`Add the chapters`}
      value={options.some((o) => o.id === value) ? value : AT_END}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
      hint={t`A part holds everything up to the next part, so chapters added at the start of a part or after a chapter inside it join that part.`}
    >
      <option value={AT_END}>{t`At the end of the book`}</option>
      {options.map((o) => (
        <option key={o.id} value={o.id}>
          {o.part ? t`At the start of ${o.title}` : t`After ${o.title}`}
        </option>
      ))}
    </Select>
  );
}
