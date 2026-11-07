import { useState } from "react";
import { useLingui } from "@lingui/react/macro";
import { useLocale } from "../../i18n/i18n";
import { PSEUDO_LOCALE } from "../../i18n/locales";
import { Field } from "../../ui/forms/Input";
import { Segmented } from "../../ui/forms/Segmented";
import { Notice } from "../../ui/feedback/Notice";
import { Select } from "../../ui/forms/Select";
import { languageOptions } from "../../ui/forms/LanguagePicker";
import { Switch } from "../../ui/forms/Switch";
import { useTheme, type Theme } from "../../state/view/theme";
import { useUpdates } from "../../state/app/updates";
import { MAX_SESSION_GOAL, useSettings, type RawHtmlPaste } from "../../state/view/editorPrefs";
import { KeepField, Row, Section } from "./SettingsParts";

/** Settings > Appearance: the theme. */
export function AppearanceSection({ title }: { title: string }) {
  const { t } = useLingui();
  const { theme, setTheme } = useTheme();
  return (
    <Section id="appearance" title={title}>
      <Row
        title={t`Theme`}
        hint={t`Follow the system or pick one.`}
        control={
          <Segmented<Theme>
            label={t`Theme`}
            value={theme}
            onChange={setTheme}
            items={[
              { value: "system", label: t`System` },
              { value: "light", label: t`Light` },
              { value: "dark", label: t`Dark` },
            ]}
          />
        }
      />
    </Section>
  );
}

/** Settings > General: interface language and the update check. */
export function GeneralSection({ title }: { title: string }) {
  const { t } = useLingui();
  const checkOnLaunch = useUpdates((s) => s.checkOnLaunch);
  const setCheckOnLaunch = useUpdates((s) => s.setCheckOnLaunch);
  const { locale, setLocale } = useLocale();
  const [languageError, setLanguageError] = useState("");
  const changeLanguage = (code: string) => {
    setLanguageError("");
    setLocale(code).catch(() => {
      const name = languageOptions.find((o) => o.code === code)?.name ?? code;
      setLanguageError(
        t`Could not load ${name}. The language stays as it was. Choose it again, or pick another language.`,
      );
    });
  };
  return (
    <Section id="general" title={title}>
      <Row
        title={t`Interface language`}
        hint={t`Language of menus and dialogs.`}
        control={
          <div className="w-56 max-sm:w-full">
            <Select
              label={t`Interface language`}
              hideLabel
              className="py-2"
              value={locale}
              errorId={languageError ? "language-error" : undefined}
              onChange={(e) => changeLanguage(e.target.value)}
            >
              {languageOptions.map((o) => (
                <option key={o.code} value={o.code} lang={o.code === PSEUDO_LOCALE ? "en" : o.code}>
                  {o.name}
                </option>
              ))}
            </Select>
            {languageError && (
              <Notice id="language-error" role="alert" className="mt-2 text-xs">
                {languageError}
              </Notice>
            )}
          </div>
        }
      />
      <Row
        title={t`Check for updates on launch`}
        hint={t`Looks for a new version when the app starts. Nothing else is sent.`}
        control={
          <Switch
            label={t`Check for updates on launch`}
            checked={checkOnLaunch}
            onChange={(v) => setCheckOnLaunch(v)}
          />
        }
      />
    </Section>
  );
}

/** Settings > Editor: typewriter scrolling, session goal and HTML paste. */
export function EditorSection({ title }: { title: string }) {
  const { t } = useLingui();
  const { typewriterScroll, sessionGoal, rawHtmlPaste, set } = useSettings();
  return (
    <Section id="editor" title={title}>
      <Row
        title={t`Typewriter scrolling`}
        hint={t`Keep the line you are writing centered.`}
        control={
          <Switch
            label={t`Typewriter scrolling`}
            checked={typewriterScroll}
            onChange={(v) => set({ typewriterScroll: v })}
          />
        }
      />
      <Row
        title={t`Session word goal`}
        hint={t`Words to write each time you open a book. 0 turns it off.`}
        control={
          <div className="w-32 max-sm:w-full">
            <Field
              label={t`Session word goal`}
              hideLabel
              className="py-2"
              type="number"
              min={0}
              max={MAX_SESSION_GOAL}
              step={50}
              value={sessionGoal}
              onChange={(e) => set({ sessionGoal: e.target.valueAsNumber })}
            />
          </div>
        }
      />
      <Row
        title={t`When pasting HTML`}
        hint={t`Raw HTML tags in pasted text: ask each time, turn them into formatting, or keep them as text.`}
        control={
          <div className="w-56 max-sm:w-full">
            <Select
              label={t`When pasting HTML`}
              hideLabel
              className="py-2"
              value={rawHtmlPaste}
              onChange={(e) => set({ rawHtmlPaste: e.target.value as RawHtmlPaste })}
            >
              <option value="ask">{t`Ask each time`}</option>
              <option value="convert">{t`Convert to styled text`}</option>
              <option value="text">{t`Keep as text`}</option>
            </Select>
          </div>
        }
      />
    </Section>
  );
}

/** Settings > Backups: how many snapshots are kept and where they live. */
export function BackupsSection({ title }: { title: string }) {
  const { t } = useLingui();
  const { snapshotKeep, set } = useSettings();
  return (
    <Section id="backups" title={title}>
      <Row
        title={t`Snapshots to keep per chapter`}
        hint={t`Older snapshots are removed, but anything from the last 30 days stays.`}
        control={
          <div className="w-32 max-sm:w-full">
            <KeepField
              key={snapshotKeep}
              label={t`Snapshots to keep per chapter`}
              value={snapshotKeep}
              onCommit={(n) => set({ snapshotKeep: n })}
            />
          </div>
        }
      />
      <Row
        title={t`When snapshots are taken`}
        hint={t`Before a save replaces different text, at most once every 10 minutes per chapter.`}
        control={null}
      />
      <Row
        title={t`Where they are stored`}
        hint={t`In the .cadabra/backups folder inside your book folder.`}
        control={null}
      />
    </Section>
  );
}
