import { plural } from "@lingui/core/macro";
import { useLingui } from "@lingui/react/macro";
import { Circle, CircleAlert, CircleCheck, CircleX, Info, LoaderCircle } from "lucide-react";
import type { AudioFormat, VoiceInfo } from "@cadabracraft/export-audio";
import { Checkbox } from "../ui/Checkbox";
import { Segmented } from "../ui/Segmented";
import { Select } from "../ui/Select";
import { cx } from "../ui/cx";
import type { AudioJob } from "./store";

export const AUDIO_SPEEDS = [0.9, 1, 1.1, 1.25] as const;
export const DEFAULT_AUDIO_FORMATS: AudioFormat[] = ["opus"];

/** Display order of the formats; the order the files are written in too. */
const FORMATS: AudioFormat[] = ["opus", "flac", "wav"];

/** The first installed voice: the catalog lists the best quality one first. */
export const defaultVoice = (voices: VoiceInfo[]): string => voices.find((v) => v.installed)?.id ?? "";

function useAudioLabels() {
  const { t } = useLingui();
  const voice = (id: string): string =>
    id === "kokoro-heart" ? t`Kokoro · Heart (best quality)` : id === "piper-amy" ? t`Piper · Amy (fast)` : id === "piper-libritts-0" ? t`Piper · LibriTTS (fast)` : id;
  const format = (f: AudioFormat) =>
    f === "opus"
      ? { label: t`Opus`, hint: t`Small files, about 14 MB per hour. Plays on phones and modern players.` }
      : f === "flac"
      ? { label: t`FLAC`, hint: t`Lossless, about 60% of the size of WAV.` }
      : { label: t`WAV`, hint: t`Lossless and large: about 1.7 GB per 10 hours.` };
  return { voice, format };
}

/** The Audiobook mode of the Export dialog: voice, speed, formats and a note about stores. Matches "Export Audiobook" in the pen. */
export function AudioFields({ voices, voice, onVoice, speed, onSpeed, formats, onFormats, chapters, disabled }: {
  voices: VoiceInfo[] | null;
  voice: string;
  onVoice: (id: string) => void;
  speed: number;
  onSpeed: (s: number) => void;
  formats: AudioFormat[];
  onFormats: (f: AudioFormat[]) => void;
  chapters: number;
  disabled: boolean;
}) {
  const { t } = useLingui();
  const names = useAudioLabels();
  const installed = (voices ?? []).filter((v) => v.installed);
  if (voices && installed.length === 0) {
    return (
      <div className="flex flex-col gap-2 rounded-lg border border-border bg-bg p-4">
        <p className="text-sm font-semibold">{t`Voices are not installed`}</p>
        <p className="text-sm text-ink-muted">{t`The voices that read your book aloud are not on this computer yet, and CadabraCraft cannot download them from here yet. Put the voice folders in the app's voices folder, then open this dialog again.`}</p>
      </div>
    );
  }
  return (
    <>
      <Select label={t`Voice`} value={voice} disabled={disabled || !voices} onChange={(e) => onVoice(e.target.value)} hint={t`Kokoro sounds the most natural but is slower: roughly 20 minutes of work per hour of audio. Piper voices are about 10 times faster.`}>
        {installed.map((v) => <option key={v.id} value={v.id}>{names.voice(v.id)}</option>)}
      </Select>
      <Segmented<string> label={t`Speed`} value={String(speed)} onChange={(v) => onSpeed(Number(v))} items={AUDIO_SPEEDS.map((s) => ({ value: String(s), label: `${s}×` }))} />
      <fieldset className="flex flex-col gap-2.5" disabled={disabled}>
        <legend className="mb-1 text-xs font-semibold text-ink-muted">{t`Formats`}</legend>
        {FORMATS.map((f) => {
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
                const next = FORMATS.filter((x) => (x === f ? e.target.checked : formats.includes(x)));
                if (next.length > 0) onFormats(next); // at least one format stays chosen
              }}
            />
          );
        })}
      </fieldset>
      <p className="text-sm text-ink-muted">{plural(chapters, { one: "Reads # chapter, as one audio file. Front and back matter are not read.", other: "Reads all # chapters, one audio file each. Front and back matter are not read." })}</p>
      <p className="flex items-start gap-2 rounded-md bg-warn-soft px-3 py-2 text-sm text-warn">
        <Info size={16} className="mt-0.5 shrink-0" aria-hidden />
        {t`Some audiobook stores do not accept synthetic voices. Check their rules before you upload.`}
      </p>
    </>
  );
}

function StateIcon({ state }: { state: AudioJob["chapters"][number]["state"] }) {
  if (state === "done" || state === "empty") return <CircleCheck size={16} className="text-success" aria-hidden />;
  if (state === "rendering") return <LoaderCircle size={16} className="animate-spin text-accent motion-reduce:animate-none" aria-hidden />;
  if (state === "failed") return <CircleX size={16} className="text-danger" aria-hidden />;
  return <Circle size={16} className="text-ink-muted" aria-hidden />;
}

/** Progress, result or failure of the audiobook export in the store. Matches the rendering, done and error frames in the pen. */
export function AudioJobView({ job }: { job: AudioJob }) {
  const { t } = useLingui();
  const done = job.chapters.filter((c) => c.state === "done" || c.state === "empty").length;
  const current = Math.min(done + 1, job.chapters.length);
  const total = job.chapters.length;
  const percent = Math.round(job.overall * 100);
  const minutes = Math.max(1, Math.round(job.durationSec / 60));
  const stateText = (c: AudioJob["chapters"][number]) =>
    c.state === "done" || c.state === "empty" ? t`Done` : c.state === "rendering" ? `${Math.round(c.progress * 100)}%` : c.state === "failed" ? t`Stopped` : t`Waiting`;
  return (
    <div className="flex flex-col gap-4">
      {job.status === "running" && (
        <div className="flex flex-col gap-2">
          <div className="flex items-baseline justify-between gap-2">
            <p role="status" className="text-sm font-semibold">{job.cancelling ? t`Stopping…` : t`Chapter ${current} of ${total}`}</p>
            <span className="text-sm text-ink-muted">{percent}%</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full border border-border bg-bg" role="progressbar" aria-label={t`Audiobook progress`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}>
            <div className="h-full rounded-full bg-accent transition-[width] motion-reduce:transition-none" style={{ width: `${percent}%` }} />
          </div>
        </div>
      )}
      {job.status === "done" && (
        <div className="flex flex-col gap-1">
          <p role="status" className="flex items-center gap-2 text-base font-semibold"><CircleCheck size={20} className="text-success" aria-hidden />{t`Your audiobook is ready`}</p>
          <p className="text-sm text-ink-muted">{t`${job.files} files, ${minutes} min. Saved in the exports folder, in audio.`}</p>
        </div>
      )}
      {job.status === "error" && job.error && (
        job.error.code === "cancelled"
          ? <p role="status" className="rounded-md bg-bg px-3 py-2 text-sm text-ink-muted">{job.error.message}</p>
          : <p role="alert" className="flex items-start gap-2 whitespace-pre-wrap break-words rounded-md bg-danger-soft px-3 py-2 text-sm text-danger"><CircleAlert size={16} className="mt-0.5 shrink-0" aria-hidden />{job.error.message}</p>
      )}
      <ul aria-label={t`Chapters`} className="flex flex-col rounded-lg border border-border">
        {job.chapters.map((c, i) => (
          <li key={c.id} className={cx("flex items-center gap-2.5 px-3.5 py-2.5 text-sm", i > 0 && "border-t border-border")}>
            <StateIcon state={c.state} />
            <span className="min-w-0 flex-1 truncate">{c.title}</span>
            <span className={cx("text-xs font-semibold", c.state === "rendering" ? "text-accent" : c.state === "failed" ? "text-danger" : "text-ink-muted")}>{stateText(c)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
