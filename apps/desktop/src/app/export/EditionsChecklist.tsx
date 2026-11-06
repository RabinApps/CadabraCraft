import { useLingui } from "@lingui/react/macro";
import {
  isTranslated,
  readingOrder,
  translationProgress,
  type Manifest,
} from "@cadabracraft/format";
import { Checkbox } from "../../ui/forms/Checkbox";
import { nativeName } from "../shell/header/EditionSwitcher";

/** Pages of `language` that are not translated yet (a copy, a blank page or no file): they stop an export unless skipped. */
export const untranslatedIn = (manifest: Manifest, language: string) =>
  readingOrder(manifest).filter((e) => !isTranslated(e, language, manifest.editions));

interface Props {
  manifest: Manifest;
  /** The edition open in the editor, tagged "Current". */
  current: string;
  picked: string[];
  skipped: string[];
  onPicked: (languages: string[]) => void;
  onSkipped: (languages: string[]) => void;
  disabled: boolean;
}

const toggle = (list: string[], language: string, on: boolean): string[] =>
  on ? [...list.filter((l) => l !== language), language] : list.filter((l) => l !== language);

/**
 * The Export dialog's "Editions" checklist (pen: "Export editions"): which editions to export, each with its chapter
 * progress. A picked edition with untranslated pages shows them with the "Skip untranslated chapters" choice.
 */
export function EditionsChecklist({
  manifest,
  current,
  picked,
  skipped,
  onPicked,
  onSkipped,
  disabled,
}: Props) {
  const { t } = useLingui();
  return (
    <fieldset className="flex flex-col gap-2.5">
      <legend className="mb-1 text-xs font-semibold text-ink-muted">{t`Editions`}</legend>
      {manifest.editions.map((e) => {
        const p = translationProgress(manifest, e.language);
        const missing = untranslatedIn(manifest, e.language);
        const on = picked.includes(e.language);
        return (
          <div key={e.language} className="flex flex-col gap-2">
            <div className="flex items-center justify-between gap-3">
              <Checkbox
                label={nativeName(e.language)}
                checked={on}
                disabled={disabled}
                onChange={(ev) => onPicked(toggle(picked, e.language, ev.target.checked))}
              />
              <span className="flex shrink-0 items-center gap-2 text-xs text-ink-muted">
                {e.language === current && (
                  <span className="rounded-full bg-accent-soft px-2 py-0.5 font-semibold text-accent">{t`Current`}</span>
                )}
                {t`${p.translated} of ${p.total} chapters`}
              </span>
            </div>
            {on && missing.length > 0 && (
              <div className="flex flex-col gap-2 rounded-md bg-warn-soft px-3 py-2.5 text-sm">
                <p className="text-ink">
                  {t`Not translated yet in ${nativeName(e.language)}: ${missing
                    .map(
                      (m) =>
                        m.titles[e.language] ?? m.titles[manifest.editions[0]!.language] ?? m.id,
                    )
                    .join(", ")}`}
                </p>
                <Checkbox
                  label={t`Skip untranslated chapters`}
                  hint={t`Leaves them out of this export; the list above says which.`}
                  checked={skipped.includes(e.language)}
                  disabled={disabled}
                  onChange={(ev) => onSkipped(toggle(skipped, e.language, ev.target.checked))}
                />
              </div>
            )}
          </div>
        );
      })}
    </fieldset>
  );
}
