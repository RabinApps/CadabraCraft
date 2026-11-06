import { useLingui } from "@lingui/react/macro";
import type { AudioFormat } from "@cadabracraft/export-audio";
import { Checkbox } from "../../../ui/forms/Checkbox";
import { Select } from "../../../ui/forms/Select";
import { AUDIO_FORMATS, toggleAudioFormat } from "../../../lib/audio/audioFormats";
import { nativeName } from "../../shell/header/EditionSwitcher";
import { useAudioLabels } from "../../hooks/useAudioLabels";
import type { AudioEditionChoice } from "../AudioExport";

/** The edition picker with the note about chapters that are not translated yet. */
export function AudioEditionPicker({
  edition,
  disabled,
}: {
  edition: AudioEditionChoice;
  disabled: boolean;
}) {
  const { t } = useLingui();
  return (
    <>
      <Select
        label={t`Edition`}
        value={edition.language}
        disabled={disabled}
        onChange={(e) => edition.onLanguage(e.target.value)}
      >
        {edition.editions.map((e) => (
          <option key={e.language} value={e.language}>
            {t`${nativeName(e.language)}: ${e.translated} of ${e.total} chapters`}
          </option>
        ))}
      </Select>
      {edition.untranslated.length > 0 && (
        <div className="flex flex-col gap-2 rounded-md bg-warn-soft px-3 py-2.5 text-sm">
          <p className="text-ink">
            {t`Not translated yet in ${nativeName(edition.language)}: ${edition.untranslated.join(", ")}`}
          </p>
          <Checkbox
            label={t`Skip untranslated chapters`}
            hint={t`Leaves them out of this audiobook; the list above says which.`}
            checked={edition.skip}
            disabled={disabled}
            onChange={(ev) => edition.onSkip(ev.target.checked)}
          />
        </div>
      )}
    </>
  );
}

/** The audio format checkboxes: at least one stays chosen. */
export function AudioFormatsFieldset({
  formats,
  onFormats,
  disabled,
}: {
  formats: AudioFormat[];
  onFormats: (f: AudioFormat[]) => void;
  disabled: boolean;
}) {
  const { t } = useLingui();
  const names = useAudioLabels();
  return (
    <fieldset className="flex flex-col gap-2.5" disabled={disabled}>
      <legend className="mb-1 text-xs font-semibold text-ink-muted">{t`Formats`}</legend>
      {AUDIO_FORMATS.map((f) => {
        const { label, hint } = names.format(f);
        const on = formats.includes(f);
        return (
          <Checkbox
            key={f}
            label={label}
            hint={hint}
            checked={on}
            disabled={disabled}
            onChange={(e) => {
              const next = toggleAudioFormat(formats, f, e.target.checked);
              if (next) onFormats(next); // at least one format stays chosen
            }}
          />
        );
      })}
    </fieldset>
  );
}

/** "All chapters / Selected chapters" and, for a selection, the list of chapters to read. */
export function AudioChapterPicker({
  chapters,
  picked,
  onPicked,
  disabled,
}: {
  chapters: { id: string; title: string }[];
  /** Chapter ids to read, or null for every chapter. */
  picked: string[] | null;
  onPicked: (ids: string[] | null) => void;
  disabled: boolean;
}) {
  const { t } = useLingui();
  return (
    <>
      <Select
        label={t`Chapters`}
        value={picked ? "some" : "all"}
        disabled={disabled}
        onChange={(e) => onPicked(e.target.value === "all" ? null : chapters.map((c) => c.id))}
      >
        <option value="all">{t`All chapters`}</option>
        <option value="some">{t`Selected chapters`}</option>
      </Select>
      {picked && (
        <fieldset
          className="flex flex-col gap-2 rounded-lg border border-border p-3"
          disabled={disabled}
        >
          <legend className="sr-only">{t`Chapters to read`}</legend>
          {chapters.map((c) => (
            <Checkbox
              key={c.id}
              label={c.title}
              checked={picked.includes(c.id)}
              onChange={(e) =>
                onPicked(
                  chapters
                    .map((x) => x.id)
                    .filter((id) => (id === c.id ? e.target.checked : picked.includes(id))),
                )
              }
            />
          ))}
        </fieldset>
      )}
    </>
  );
}
