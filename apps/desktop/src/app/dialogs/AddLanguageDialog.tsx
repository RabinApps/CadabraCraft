import { useEffect, useState } from "react";
import { useLingui } from "@lingui/react/macro";
import { Modal } from "../../ui/Dialog";
import { Button } from "../../ui/Button";
import { Select } from "../../ui/Select";
import { cx } from "../../ui/cx";
import { whyText } from "../../lib/projectError";
import { ENABLED_LOCALE_INFO, LOCALES } from "../../i18n/locales";
import { useProject } from "../../state/project/index";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const option =
  "flex cursor-pointer gap-3 rounded-md border px-3 py-2.5 text-sm has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-accent";

/** Adds a translation edition: a language from the list, and whether it starts as copies of the source or as blank pages. */
export function AddLanguageDialog({ open, onOpenChange }: Props) {
  const { t } = useLingui();
  const editions = useProject((s) => s.manifest?.editions ?? []);
  const actions = useProject((s) => s.actions);
  const available = ENABLED_LOCALE_INFO.filter((l) => !editions.some((e) => e.language === l.code));
  const [language, setLanguage] = useState(available[0]?.code ?? "");
  const [mode, setMode] = useState<"copy" | "empty">("copy");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const firstAvailable = available[0]?.code ?? "";
  // Each opening starts fresh: the language added last time is no longer on offer, and an old error must not linger.
  useEffect(() => {
    if (!open) return;
    setLanguage(firstAvailable);
    setMode("copy");
    setError("");
  }, [open, firstAvailable]);
  const sourceCode = editions[0]?.language ?? "";
  const sourceName = LOCALES.find((l) => l.code === sourceCode)?.nativeName ?? sourceCode;
  const add = async () => {
    setBusy(true);
    setError("");
    try {
      await actions.addLanguage(language, mode);
      onOpenChange(false);
    } catch (e) {
      const why = whyText(e);
      setError(t`Could not add the language: ${why}. Choose another language, or try again.`);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open={open} onOpenChange={(o) => !busy && onOpenChange(o)} title={t`Add language`}>
      {available.length === 0 ? (
        <p className="text-sm text-ink-muted">{t`Every language is already in this book.`}</p>
      ) : (
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            void add();
          }}
        >
          <Select
            label={t`Language`}
            value={language}
            errorId={error ? "add-language-error" : undefined}
            onChange={(e) => setLanguage(e.target.value)}
          >
            {available.map((l) => (
              <option key={l.code} value={l.code}>
                {l.nativeName}
              </option>
            ))}
          </Select>
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1.5 text-xs font-semibold text-ink-muted">
              {t`Start the new edition`}
            </legend>
            {(
              [
                [
                  "copy",
                  t`Start from a copy of the source`,
                  t`Chapters start as ${sourceName} copies, marked Not translated yet.`,
                ],
                ["empty", t`Start empty`, t`Every chapter starts blank.`],
              ] as const
            ).map(([value, label, hint]) => (
              <label
                key={value}
                className={cx(
                  option,
                  mode === value
                    ? "border-accent bg-accent-soft"
                    : "border-border-strong bg-surface",
                )}
              >
                <input
                  type="radio"
                  name="edition-start"
                  value={value}
                  checked={mode === value}
                  onChange={() => setMode(value)}
                  className="mt-1 accent-accent"
                />
                <span className="flex flex-col gap-0.5">
                  <span className="font-semibold text-ink">{label}</span>
                  <span className="text-xs text-ink-muted">{hint}</span>
                </span>
              </label>
            ))}
          </fieldset>
          {error && (
            <p id="add-language-error" role="alert" className="text-sm text-danger">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button disabled={busy} onClick={() => onOpenChange(false)}>{t`Cancel`}</Button>
            <Button variant="primary" type="submit" disabled={busy || !language}>
              {t`Add language`}
            </Button>
          </div>
        </form>
      )}
    </Modal>
  );
}
