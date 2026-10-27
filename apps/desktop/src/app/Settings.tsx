import { useCallback, useEffect, useState, type ReactNode } from "react";
import { useLingui } from "@lingui/react/macro";
import { ArrowLeft } from "lucide-react";
import { useLocale } from "../i18n/i18n";
import { PSEUDO_LOCALE } from "../i18n/locales";
import { IconButton } from "../ui/Button";
import { Button } from "../ui/Button";
import { Checkbox } from "../ui/Checkbox";
import { Field } from "../ui/Input";
import { bridge, type VoicePack } from "../lib/bridge";
import { describeAudioError } from "../lib/audioErrors";
import type { VoiceInfo } from "@cadabracraft/export-audio";
import { AUDIO_FORMATS_ORDER, mb, useAudioLabels } from "./AudioExport";
import { Segmented } from "../ui/Segmented";
import { Select } from "../ui/Select";
import { languageOptions } from "../ui/LanguagePicker";
import { Switch } from "../ui/Switch";
import { useTheme, type Theme } from "./theme";
import { useUpdates } from "./updates";
import type { AudioFormat } from "@cadabracraft/export-audio";
import { MAX_SESSION_GOAL, SNAPSHOT_KEEP_MAX, SNAPSHOT_KEEP_MIN, cleanSnapshotKeep, useSettings, type ManuscriptFont, type RawHtmlPaste, type WritingWidth } from "./editorPrefs";

const sections = ["appearance", "general", "editor", "audio", "backups"] as const;

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

/** Snapshots to keep: edits stay local while typing and are applied on blur, so "2" on the way to "20" is not clamped to the minimum. */
function KeepField({ label, value, onCommit }: { label: string; value: number; onCommit: (n: number) => void }) {
  const [text, setText] = useState(String(value));
  return (
    <Field
      label={label}
      hideLabel
      className="py-2"
      type="number"
      min={SNAPSHOT_KEEP_MIN}
      max={SNAPSHOT_KEEP_MAX}
      step={5}
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => { const n = cleanSnapshotKeep(Number(text)); onCommit(n); setText(String(n)); }}
    />
  );
}

/** Audiobook preferences: the voice and formats the export starts with, and the downloaded voices with a way to remove them. */
function AudioSection({ title, voice, formats, onVoice, onFormats }: {
  title: string;
  voice: string;
  formats: AudioFormat[];
  onVoice: (id: string) => void;
  onFormats: (f: AudioFormat[]) => void;
}) {
  const { t } = useLingui();
  const names = useAudioLabels();
  const [voices, setVoices] = useState<VoiceInfo[]>([]);
  const [packs, setPacks] = useState<VoicePack[]>([]);
  const [confirm, setConfirm] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const refresh = useCallback(async (live: () => boolean = () => true) => {
    try {
      const [v, p] = await Promise.all([bridge.audioVoices(), bridge.audioPacks()]);
      if (live()) { setVoices(v); setPacks(p); }
    } catch (e) {
      if (live()) setError(describeAudioError(e).message);
    }
  }, []);
  useEffect(() => {
    let live = true;
    void refresh(() => live);
    return () => { live = false; };
  }, [refresh]);
  const remove = async (id: string) => {
    setConfirm(null);
    setError(null);
    try {
      await bridge.audioDeletePack(id);
    } catch (e) {
      setError(describeAudioError(e).message);
    }
    await refresh();
  };
  const packName = (p: VoicePack) => (p.id === "piper" ? t`Piper voices: Amy and LibriTTS` : t`Kokoro: Heart`);
  const installed = voices.filter((v) => v.installed);
  return (
    <Section id="audio" title={title}>
      <Row
        title={t`Default voice`}
        hint={t`The voice the audiobook export starts with. Only installed voices can be picked.`}
        control={
          <div className="w-56 max-sm:w-full">
            <Select label={t`Default voice`} hideLabel className="py-2" value={installed.some((v) => v.id === voice) ? voice : ""} onChange={(e) => onVoice(e.target.value)}>
              <option value="">{t`Best installed voice`}</option>
              {installed.map((v) => <option key={v.id} value={v.id}>{names.voice(v.id)}</option>)}
            </Select>
          </div>
        }
      />
      <Row
        title={t`Default formats`}
        hint={t`The audio formats ticked when you open the export.`}
        control={
          <fieldset className="flex gap-4">
            <legend className="sr-only">{t`Default formats`}</legend>
            {AUDIO_FORMATS_ORDER().map((f) => (
              <Checkbox
                key={f}
                label={names.format(f).label}
                checked={formats.includes(f)}
                onChange={(e) => {
                  const next = AUDIO_FORMATS_ORDER().filter((x) => (x === f ? e.target.checked : formats.includes(x)));
                  if (next.length > 0) onFormats(next);
                }}
              />
            ))}
          </fieldset>
        }
      />
      {packs.map((p) => (
        <Row
          key={p.id}
          title={packName(p)}
          hint={p.installed ? t`Installed, about ${mb(p.bytes)} MB on this computer.` : t`Not installed. Download it from the Audiobook export.`}
          control={
            p.installed ? (
              confirm === p.id ? (
                <div className="flex gap-2">
                  <Button onClick={() => setConfirm(null)}>{t`Keep`}</Button>
                  <Button variant="danger" onClick={() => void remove(p.id)}>{t`Delete voices`}</Button>
                </div>
              ) : (
                <Button onClick={() => setConfirm(p.id)}>{t`Delete`}</Button>
              )
            ) : null
          }
        />
      ))}
      {error && <p role="alert" className="px-4 py-3 text-sm text-danger">{error}</p>}
    </Section>
  );
}

/** Preferences page. Every control saves immediately, so there is no primary action. */
export function Settings({ onBack }: { onBack: () => void }) {
  const { t } = useLingui();
  const { theme, setTheme } = useTheme();
  const { manuscriptFont, writingWidth, typewriterScroll, sessionGoal, rawHtmlPaste, snapshotKeep, audioVoice, audioFormats, set } = useSettings();
  const checkOnLaunch = useUpdates((s) => s.checkOnLaunch);
  const setCheckOnLaunch = useUpdates((s) => s.setCheckOnLaunch);
  const { locale, setLocale } = useLocale();
  const navLabels: Record<(typeof sections)[number], string> = { appearance: t`Appearance`, general: t`General`, editor: t`Editor`, audio: t`Audio`, backups: t`Backups` };
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
              <Row
                title={t`When pasting HTML`}
                hint={t`Raw HTML tags in pasted text: ask each time, turn them into formatting, or keep them as text.`}
                control={
                  <div className="w-56 max-sm:w-full">
                    <Select label={t`When pasting HTML`} hideLabel className="py-2" value={rawHtmlPaste} onChange={(e) => set({ rawHtmlPaste: e.target.value as RawHtmlPaste })}>
                      <option value="ask">{t`Ask each time`}</option>
                      <option value="convert">{t`Convert to styled text`}</option>
                      <option value="text">{t`Keep as text`}</option>
                    </Select>
                  </div>
                }
              />
            </Section>
            <AudioSection voice={audioVoice} formats={audioFormats} title={navLabels.audio} onVoice={(v) => set({ audioVoice: v })} onFormats={(f) => set({ audioFormats: f })} />
            <Section id="backups" title={navLabels.backups}>
              <Row
                title={t`Snapshots to keep per chapter`}
                hint={t`Older snapshots are removed, but anything from the last 30 days stays.`}
                control={<div className="w-32 max-sm:w-full"><KeepField key={snapshotKeep} label={t`Snapshots to keep per chapter`} value={snapshotKeep} onCommit={(n) => set({ snapshotKeep: n })} /></div>}
              />
              <Row title={t`When snapshots are taken`} hint={t`Before a save replaces different text, at most once every 10 minutes per chapter.`} control={null} />
              <Row title={t`Where they are stored`} hint={t`In the .cadabra/backups folder inside your book folder.`} control={null} />
            </Section>
            <p className="-mt-4 text-xs text-ink-muted">{t`Open a chapter's History from its menu in the chapter list to compare and restore. Keep .cadabra out of cloud sync: snapshots belong to this computer.`}</p>
          </div>
        </main>
      </div>
    </div>
  );
}
