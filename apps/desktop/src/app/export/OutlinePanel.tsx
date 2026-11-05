import { useId } from "react";
import { useLingui } from "@lingui/react/macro";
import type { OutlineFormat } from "@cadabracraft/outline";

/** The Outline format: which file to write (OPML, Markdown or CSV). The outline lists chapters and scenes with their notes and never the text. */
export function OutlinePanel({
  value,
  onChange,
  disabled,
}: {
  value: OutlineFormat;
  onChange: (f: OutlineFormat) => void;
  disabled: boolean;
}) {
  const { t } = useLingui();
  const name = useId();
  const options: { value: OutlineFormat; label: string; hint: string }[] = [
    {
      value: "opml",
      label: t`OPML (.opml)`,
      hint: t`Opens in outliners such as OmniOutliner or Bike, with every scene note kept.`,
    },
    {
      value: "markdown",
      label: t`Markdown (.md)`,
      hint: t`A heading for each chapter and scene, the synopsis below it.`,
    },
    { value: "csv", label: t`CSV (.csv)`, hint: t`One row per scene, for a spreadsheet.` },
  ];
  return (
    <fieldset className="flex flex-col gap-2.5" disabled={disabled}>
      <legend className="mb-2.5 text-sm font-semibold text-ink">{t`File type`}</legend>
      {options.map((o) => (
        <div key={o.value} className="flex items-start gap-2.5">
          <input
            id={`${name}-${o.value}`}
            type="radio"
            name={name}
            value={o.value}
            checked={value === o.value}
            aria-describedby={`${name}-${o.value}-hint`}
            onChange={() => onChange(o.value)}
            className="mt-0.5 size-4 max-md:mt-3.5 shrink-0 accent-accent focus-visible:outline-2 focus-visible:outline-accent"
          />
          <div className="flex flex-col gap-0.5">
            <label
              htmlFor={`${name}-${o.value}`}
              className="block text-sm font-semibold text-ink max-md:py-3"
            >
              {o.label}
            </label>
            <p id={`${name}-${o.value}-hint`} className="text-xs text-ink-muted">
              {o.hint}
            </p>
          </div>
        </div>
      ))}
    </fieldset>
  );
}
