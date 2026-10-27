import type { ReactNode } from "react";
import { useLingui } from "@lingui/react/macro";
import { ArrowLeft } from "lucide-react";
import { useLocale } from "../i18n/i18n";
import { PSEUDO_LOCALE } from "../i18n/locales";
import { IconButton } from "../ui/Button";
import { Field } from "../ui/Input";
import { Segmented } from "../ui/Segmented";
import { Select } from "../ui/Select";
import { languageOptions } from "../ui/LanguagePicker";
import { Switch } from "../ui/Switch";
import { useTheme, type Theme } from "./theme";
import { useUpdates } from "./updates";
import { MAX_SESSION_GOAL, useSettings, type ManuscriptFont, type WritingWidth } from "./editorPrefs";

const sections = ["appearance", "general", "editor"] as const;

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-heading`} className="flex scroll-mt-4 flex-col gap-3">
      <h2 id={`${id}-heading`} className="font-book text-xl font-semibold">{title}</h2>
      <div className="flex flex-col divide-y divide-border rounded-[14px] border border-border bg-surface">{children}</div>
    </section>
  );
}

function Row({ title, hint, control }: { title: string; hint: string; control: ReactNode }) {
  return (
    <div className="flex flex-col gap-3 px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="text-sm font-semibold">{title}</span>
        <span className="text-xs text-ink-muted">{hint}</span>
      </div>
      <div className="shrink-0 max-sm:w-full">{control}</div>
    </div>
  );
}

/** Preferences page. Every control saves immediately, so there is no primary action. */
export function Settings({ onBack }: { onBack: () => void }) {
  const { t } = useLingui();
  const { theme, setTheme } = useTheme();
  const { manuscriptFont, writingWidth, typewriterScroll, sessionGoal, set } = useSettings();
  const checkOnLaunch = useUpdates((s) => s.checkOnLaunch);
  const setCheckOnLaunch = useUpdates((s) => s.setCheckOnLaunch);
  const { locale, setLocale } = useLocale();
  const navLabels: Record<(typeof sections)[number], string> = { appearance: t`Appearance`, general: t`General`, editor: t`Editor` };
  const jump = (id: string) => document.getElementById(id)?.scrollIntoView({ block: "start", behavior: "smooth" });
  return (
    <div className="flex h-dvh flex-col bg-bg text-ink">
      <header className="flex items-center gap-3 border-b border-border bg-surface px-4 py-2">
        <IconButton icon={ArrowLeft} label={t`Back`} onClick={onBack} />
        <h1 className="font-book text-base font-semibold">{t`Settings`}</h1>
      </header>
      <div className="flex min-h-0 flex-1">
        <nav aria-label={t`Settings sections`} className="hidden w-[220px] shrink-0 flex-col gap-0.5 bg-sidebar p-3 sm:flex">
          {sections.map((id) => (
            <button key={id} type="button" onClick={() => jump(id)} className="rounded-md px-3 py-2 text-start text-sm font-medium text-ink-muted hover:bg-accent-soft hover:text-ink focus-visible:outline-2 focus-visible:outline-accent">
              {navLabels[id]}
            </button>
          ))}
          {/* Designed, not built yet: shown so the list matches the design. */}
          <button type="button" disabled className="rounded-md px-3 py-2 text-start text-sm font-medium text-ink-muted opacity-50">{t`Backups`}</button>
          <button type="button" disabled className="rounded-md px-3 py-2 text-start text-sm font-medium text-ink-muted opacity-50">{t`Shortcuts`}</button>
        </nav>
        <main className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto flex max-w-[640px] flex-col gap-8 p-4 md:p-10">
            <Section id="appearance" title={navLabels.appearance}>
              <Row
                title={t`Theme`}
                hint={t`Follow the system or pick one.`}
                control={
                  <Segmented<Theme>
                    label={t`Theme`}
                    value={theme}
                    onChange={setTheme}
                    items={[{ value: "system", label: t`System` }, { value: "light", label: t`Light` }, { value: "dark", label: t`Dark` }]}
                  />
                }
              />
            </Section>
            <Section id="general" title={navLabels.general}>
              <Row
                title={t`Interface language`}
                hint={t`Language of menus and dialogs.`}
                control={
                  <div className="w-56 max-sm:w-full">
                    <Select label={t`Interface language`} hideLabel className="py-2" value={locale} onChange={(e) => void setLocale(e.target.value)}>
                      {languageOptions.map((o) => <option key={o.code} value={o.code} lang={o.code === PSEUDO_LOCALE ? "en" : o.code}>{o.name}</option>)}
                    </Select>
                  </div>
                }
              />
              <Row
                title={t`Check for updates on launch`}
                hint={t`Looks for a new version when the app starts. Nothing else is sent.`}
                control={<Switch label={t`Check for updates on launch`} checked={checkOnLaunch} onChange={(v) => setCheckOnLaunch(v)} />}
              />
            </Section>
            <Section id="editor" title={navLabels.editor}>
              <Row
                title={t`Manuscript font`}
                hint={t`Used while writing and reading.`}
                control={
                  <div className="w-56 max-sm:w-full">
                    <Select label={t`Manuscript font`} hideLabel className="py-2" value={manuscriptFont} onChange={(e) => set({ manuscriptFont: e.target.value as ManuscriptFont })}>
                      <option value="newsreader">Newsreader</option>
                      <option value="inter">Inter</option>
                    </Select>
                  </div>
                }
              />
              <Row
                title={t`Writing column width`}
                hint={t`How wide the page is in the editor.`}
                control={
                  <Segmented<WritingWidth>
                    label={t`Writing column width`}
                    value={writingWidth}
                    onChange={(v) => set({ writingWidth: v })}
                    items={[{ value: "narrow", label: t`Narrow` }, { value: "medium", label: t`Medium` }, { value: "wide", label: t`Wide` }]}
                  />
                }
              />
              <Row
                title={t`Typewriter scrolling`}
                hint={t`Keep the line you are writing centered.`}
                control={<Switch label={t`Typewriter scrolling`} checked={typewriterScroll} onChange={(v) => set({ typewriterScroll: v })} />}
              />
              <Row
                title={t`Session word goal`}
                hint={t`Words to write each time you open a book. 0 turns it off.`}
                control={
                  <div className="w-32 max-sm:w-full">
                    <Field label={t`Session word goal`} hideLabel className="py-2" type="number" min={0} max={MAX_SESSION_GOAL} step={50} value={sessionGoal} onChange={(e) => set({ sessionGoal: e.target.valueAsNumber })} />
                  </div>
                }
              />
            </Section>
          </div>
        </main>
      </div>
    </div>
  );
}
