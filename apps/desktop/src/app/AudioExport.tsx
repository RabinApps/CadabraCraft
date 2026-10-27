import { plural } from "@lingui/core/macro";
import { useLingui } from "@lingui/react/macro";
import { Circle, CircleAlert, CircleCheck, CircleX, Download, Info, LoaderCircle } from "lucide-react";
import type { AudioFormat, VoiceInfo } from "@cadabracraft/export-audio";
import { Checkbox } from "../ui/Checkbox";
import { Segmented } from "../ui/Segmented";
import { Select } from "../ui/Select";
import { cx } from "../ui/cx";
import type { VoicePack } from "../lib/bridge";
import type { AudioJob, VoiceDownload } from "./store";

export const AUDIO_SPEEDS = [0.9, 1, 1.1, 1.25] as const;
export const DEFAULT_AUDIO_FORMATS: AudioFormat[] = ["opus"];

/** Display order of the formats; the order the files are written in too. */
const FORMATS: AudioFormat[] = ["opus", "flac", "wav"];

/** The first installed voice: the catalog lists the best quality one first. */
export const defaultVoice = (voices: VoiceInfo[]): string => voices.find((v) => v.installed)?.id ?? "";

/** Download sizes are shown in decimal megabytes, like the operating system does. */
export const mb = (bytes: number): number => Math.max(1, Math.round(bytes / 1e6));

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
export function AudioFields({ voices, voice, onVoice, speed, onSpeed, formats, onFormats, chapters, disabled, moreBytes, onMore }: {
  voices: VoiceInfo[] | null;
  voice: string;
  onVoice: (id: string) => void;
  speed: number;
  onSpeed: (s: number) => void;
  formats: AudioFormat[];
  onFormats: (f: AudioFormat[]) => void;
  chapters: number;
  disabled: boolean;
  /** Download size of the voices that are not installed yet; with `onMore`, offers to download them. */
  moreBytes?: number;
  onMore?: () => void;
}) {
  const { t } = useLingui();
  const names = useAudioLabels();
  const installed = (voices ?? []).filter((v) => v.installed);
  return (
    <>
      <Select label={t`Voice`} value={voice} disabled={disabled || !voices} onChange={(e) => onVoice(e.target.value)} hint={t`Kokoro sounds the most natural but is slower: roughly 20 minutes of work per hour of audio. Piper voices are about 10 times faster.`}>
        {installed.map((v) => <option key={v.id} value={v.id}>{names.voice(v.id)}</option>)}
      </Select>
      {onMore && moreBytes ? <button type="button" className="-mt-2 self-start text-sm font-semibold text-accent hover:underline focus-visible:outline-2 focus-visible:outline-accent" onClick={onMore}>{t`Download more voices (${mb(moreBytes)} MB)`}</button> : null}
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

/** The "Voices are not installed" panel: pick what to download, then progress or a failure with a retry. Matches the pen frame. */
export function VoiceDownloadPanel({ packs, picked, onPicked, download, none }: {
  /** The packs that are not installed yet. */
  packs: VoicePack[];
  picked: string[];
  onPicked: (ids: string[]) => void;
  download: VoiceDownload | null;
  /** No voice is installed at all (the title says so); otherwise this is "download more". */
  none: boolean;
}) {
  const { t } = useLingui();
  const info = (id: string) =>
    id === "piper"
      ? { label: t`Piper voices: Amy and LibriTTS`, hint: t`Fast and clear.` }
      : { label: t`Kokoro: Heart`, hint: t`Most natural, slower.` };
  const percent = download && download.total > 0 ? Math.min(100, Math.round((download.done / download.total) * 100)) : 0;
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-bg p-4">
      <p className="flex items-center gap-2 text-sm font-semibold"><Download size={16} className="text-accent" aria-hidden />{none ? t`Voices are not installed` : t`Download more voices`}</p>
      <p className="text-sm text-ink-muted">{t`Voices are downloaded once from Hugging Face and GitHub and then work offline. This is the only time CadabraCraft uses the network for audio.`}</p>
      {download ? (
        <div className="flex flex-col gap-2">
          <div className="flex items-baseline justify-between gap-2">
            <p role="status" className="text-sm font-semibold">{download.cancelling ? t`Stopping…` : download.status === "error" ? t`The download stopped` : t`Downloading…`}</p>
            <span className="text-sm text-ink-muted">{t`${mb(download.done)} of ${mb(download.total)} MB`}</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full border border-border bg-raised" role="progressbar" aria-label={t`Download progress`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}>
            <div className="h-full rounded-full bg-accent transition-[width] motion-reduce:transition-none" style={{ width: `${percent}%` }} />
          </div>
          {download.status === "error" && download.error && (
            download.error.code === "cancelled"
              ? <p role="status" className="text-sm text-ink-muted">{t`Stopped. What was downloaded is kept, so the next download carries on from there.`}</p>
              : <p role="alert" className="flex items-start gap-2 whitespace-pre-wrap break-words rounded-md bg-danger-soft px-3 py-2 text-sm text-danger"><CircleAlert size={16} className="mt-0.5 shrink-0" aria-hidden />{download.error.message}</p>
          )}
        </div>
      ) : (
        <fieldset className="flex flex-col gap-2.5">
          <legend className="sr-only">{t`Voices to download`}</legend>
          {packs.map((p) => (
            <Checkbox
              key={p.id}
              label={info(p.id).label}
              hint={t`${info(p.id).hint} About ${mb(p.bytes)} MB.`}
              checked={picked.includes(p.id)}
              onChange={(e) => onPicked(e.target.checked ? [...picked, p.id] : picked.filter((x) => x !== p.id))}
            />
          ))}
        </fieldset>
      )}
      <p className="text-xs text-ink-muted">{t`The voices' licences are listed in Settings, Audio.`}</p>
    </div>
  );
}
