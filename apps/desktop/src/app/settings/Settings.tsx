import { useEffect, useRef, useState } from "react";
import { useLingui } from "@lingui/react/macro";
import { ArrowLeft } from "lucide-react";
import { useLocale } from "../../i18n/i18n";
import { PSEUDO_LOCALE } from "../../i18n/locales";
import { IconButton } from "../../ui/Button";
import { currentSection, SECTION_TOP_GAP } from "../../lib/settingsScroll";
import { cx } from "../../ui/cx";
import { Field } from "../../ui/Input";
import { Segmented } from "../../ui/Segmented";
import { Select } from "../../ui/Select";
import { languageOptions } from "../../ui/LanguagePicker";
import { Switch } from "../../ui/Switch";
import { useTheme, type Theme } from "../../state/theme";
import { useUpdates } from "../../state/updates";
import {
  BUNDLED_EDITOR_FONTS,
  MAX_SESSION_GOAL,
  useSettings,
  type EditorFont,
  type RawHtmlPaste,
  type WritingWidth,
} from "../../state/editorPrefs";
import { useFontList } from "../hooks/useFontList";
import { AudioSection } from "./AudioSection";
import { FontsSection } from "./FontsSection";
import { KeepField, Row, Section } from "./SettingsParts";

const sections = ["appearance", "general", "editor", "fonts", "audio", "backups"] as const;

/** Preferences page. Every control saves immediately, so there is no primary action. */
export function Settings({
  onBack,
  initialSection,
}: {
  onBack: () => void;
  /** Scroll to this section when the page opens. */
  initialSection?: (typeof sections)[number];
}) {
  const { t } = useLingui();
  const { theme, setTheme } = useTheme();
  const {
    manuscriptFont,
    writingWidth,
    typewriterScroll,
    sessionGoal,
    rawHtmlPaste,
    snapshotKeep,
    audioVoice,
    audioFormats,
    set,
  } = useSettings();
  const checkOnLaunch = useUpdates((s) => s.checkOnLaunch);
  const setCheckOnLaunch = useUpdates((s) => s.setCheckOnLaunch);
  const { locale, setLocale } = useLocale();
  const navLabels: Record<(typeof sections)[number], string> = {
    appearance: t`Appearance`,
    general: t`General`,
    editor: t`Editor`,
    fonts: t`Fonts`,
    audio: t`Audio`,
    backups: t`Backups`,
  };
  const [active, setActive] = useState<(typeof sections)[number]>(initialSection ?? "appearance");
  const { fonts } = useFontList();
  const mainRef = useRef<HTMLElement>(null);
  /** Until this time a nav click is scrolling, and the scroll must not move the highlight off the section that was clicked. */
  const jumpingUntil = useRef(0);
  // Scrolls the content area only; scrollIntoView would also scroll the page behind it and push the header away.
  const scrollTo = (id: string, behavior: ScrollBehavior) => {
    const main = mainRef.current;
    const el = document.getElementById(id);
    if (!main || !el) return;
    const top = el.getBoundingClientRect().top - main.getBoundingClientRect().top;
    main.scrollTo({ top: main.scrollTop + top - SECTION_TOP_GAP, behavior });
  };
  useEffect(() => {
    if (initialSection) scrollTo(initialSection, "auto");
  }, [initialSection]);
  const jump = (id: (typeof sections)[number]) => {
    setActive(id);
    jumpingUntil.current = Date.now() + 800;
    scrollTo(id, "smooth");
  };
  // The nav follows the content when it is scrolled by hand.
  const follow = () => {
    const main = mainRef.current;
    if (!main || Date.now() < jumpingUntil.current) return;
    const from = main.getBoundingClientRect().top;
    const tops = sections.map(
      (id) => (document.getElementById(id)?.getBoundingClientRect().top ?? 0) - from,
    );
    const atEnd = main.scrollTop + main.clientHeight >= main.scrollHeight - 2;
    setActive(sections[currentSection(tops, atEnd)]!);
  };
  return (
    <div className="flex h-dvh flex-col bg-bg text-ink">
      <header className="flex items-center gap-3 border-b border-border bg-surface px-4 py-2">
        <IconButton icon={ArrowLeft} label={t`Back`} onClick={onBack} />
        <h1 className="font-book text-base font-semibold">{t`Settings`}</h1>
      </header>
      <div className="flex min-h-0 flex-1">
        <nav
          aria-label={t`Settings sections`}
          className="hidden w-[220px] shrink-0 flex-col gap-0.5 bg-sidebar p-3 sm:flex"
        >
          {sections.map((id) => (
            <button
              key={id}
              type="button"
              aria-current={id === active ? "location" : undefined}
              onClick={() => jump(id)}
              className={cx(
                "rounded-md px-3 py-2 text-start text-sm font-medium hover:bg-accent-soft hover:text-ink focus-visible:outline-2 focus-visible:outline-accent",
                id === active ? "bg-accent-soft text-ink" : "text-ink-muted",
              )}
            >
              {navLabels[id]}
            </button>
          ))}
          {/* Designed, not built yet: shown so the list matches the design. */}
          <button
            type="button"
            disabled
            className="rounded-md px-3 py-2 text-start text-sm font-medium text-ink-muted opacity-50"
          >{t`Shortcuts`}</button>
        </nav>
        {/* relative: the visually hidden inputs inside are positioned against this box, not the window, so they cannot make the page itself scroll. */}
        <main ref={mainRef} onScroll={follow} className="relative min-h-0 flex-1 overflow-y-auto">
          {/* The bottom space lets the last sections scroll up to the top, where the nav jump puts them. */}
          <div className="mx-auto flex max-w-[640px] flex-col gap-8 p-4 sm:pb-[70dvh] md:p-10 md:pb-[70dvh]">
            <Section id="appearance" title={navLabels.appearance}>
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
            <Section id="general" title={navLabels.general}>
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
                      onChange={(e) => void setLocale(e.target.value)}
                    >
                      {languageOptions.map((o) => (
                        <option
                          key={o.code}
                          value={o.code}
                          lang={o.code === PSEUDO_LOCALE ? "en" : o.code}
                        >
                          {o.name}
                        </option>
                      ))}
                    </Select>
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
            <Section id="editor" title={navLabels.editor}>
              <Row
                title={t`Manuscript font`}
                hint={t`Used while writing. Your book's print fonts are set in Export.`}
                control={
                  <div className="w-56 max-sm:w-full">
                    <Select
                      label={t`Manuscript font`}
                      hideLabel
                      className="py-2"
                      value={manuscriptFont}
                      onChange={(e) => set({ manuscriptFont: e.target.value as EditorFont })}
                    >
                      <option value="newsreader">Newsreader</option>
                      <option value="inter">Inter</option>
                      {/* A chosen font that was deleted stays listed, so the select does not show a different one. */}
                      {!BUNDLED_EDITOR_FONTS.includes(manuscriptFont as "inter") &&
                        !fonts.some((f) => f.family === manuscriptFont) && (
                          <option value={manuscriptFont}>{manuscriptFont}</option>
                        )}
                      {fonts
                        .filter((f) => f.source !== "bundled")
                        .map((f) => (
                          <option key={f.family} value={f.family}>
                            {f.family}
                          </option>
                        ))}
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
                    items={[
                      { value: "narrow", label: t`Narrow` },
                      { value: "medium", label: t`Medium` },
                      { value: "wide", label: t`Wide` },
                    ]}
                  />
                }
              />
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
            <FontsSection title={navLabels.fonts} />
            <AudioSection
              voice={audioVoice}
              formats={audioFormats}
              title={navLabels.audio}
              onVoice={(v) => set({ audioVoice: v })}
              onFormats={(f) => set({ audioFormats: f })}
            />
            <Section id="backups" title={navLabels.backups}>
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
            <p className="-mt-4 text-xs text-ink-muted">{t`Open a chapter's History from its menu in the chapter list to compare and restore. Keep .cadabra out of cloud sync: snapshots belong to this computer.`}</p>
          </div>
        </main>
      </div>
    </div>
  );
}
