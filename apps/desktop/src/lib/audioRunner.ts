import {
  AudioExportError,
  AudioTimeoutError,
  CancelledError,
  ChecksumError,
  DownloadError,
  DiskFullError,
  EncodeError,
  EngineNotFoundError,
  SynthesisError,
  VoiceNotInstalledError,
  type AudioRunner,
  type RenderRequest,
} from "@cadabracraft/export-audio";
import { exportDir } from "@cadabracraft/format";
import type { Bridge } from "./bridge";
import { errText } from "./projectError";

/** Error shapes the Rust side sends (`AudioError` in src-tauri/src/audio.rs). */
type RustError =
  | { kind: "not_found"; message: string }
  | { kind: "voice_missing"; voice: string }
  | { kind: "synth"; message: string }
  | { kind: "encode"; format: string; message: string }
  | { kind: "disk_full" }
  | { kind: "timeout"; seconds: number }
  | { kind: "cancelled" }
  | { kind: "download"; message: string }
  | { kind: "checksum"; file: string }
  | { kind: "other"; message: string };

/** Turns whatever `invoke` rejected with into the export-audio error classes the UI knows how to describe. */
export function mapAudioError(e: unknown): Error {
  if (e instanceof AudioExportError) return e;
  if (e && typeof e === "object" && "kind" in e) {
    const r = e as RustError;
    switch (r.kind) {
      case "not_found":
        return new EngineNotFoundError(r.message);
      case "voice_missing":
        return new VoiceNotInstalledError(r.voice);
      case "synth":
        return new SynthesisError(r.message);
      case "encode":
        return new EncodeError(r.format, r.message);
      case "disk_full":
        return new DiskFullError();
      case "timeout":
        return new AudioTimeoutError(r.seconds);
      case "cancelled":
        return new CancelledError();
      case "download":
        return new DownloadError(r.message);
      case "checksum":
        return new ChecksumError(r.file);
      default:
        return new AudioExportError(r.message);
    }
  }
  return new AudioExportError(errText(e));
}

const slugOf = (title: string): string =>
  title
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/, "");

/** The folder an edition's audiobook goes to: `exports/<lang>/audio`, beside that edition's other exports. */
export function audioDir(language: string): string {
  return `${exportDir(language)}/audio`;
}

/** `exports/fr/audio/03-hostile-characters`: ordered, ASCII and safe in any file system (the Rust side checks the path again). */
export function chapterBase(dir: string, index: number, title: string): string {
  return `${dir}/${String(index + 1).padStart(2, "0")}-${slugOf(title) || "chapter"}`;
}

/** `exports/fr/audio/my-book`: where the whole-book M4B goes (without the extension). */
export function bookBase(dir: string, title: string): string {
  return `${dir}/${slugOf(title) || "audiobook"}`;
}

const safeName = (s: string): string => s.replace(/[^A-Za-z0-9_-]+/g, "_");

/**
 * Where a chapter's lossless part for the M4B is kept. The language is part of the name, so two editions of one chapter never
 * share a part; the name is reduced to the characters the Rust side accepts.
 */
export function chapterPart(language: string, chapterId: string): string {
  return `.cadabra/audio/parts/${safeName(language) || "x"}_${safeName(chapterId) || "chapter"}.flac`;
}

/**
 * An `AudioRunner` over the Tauri commands. Synthesis and encoding run in Rust on a worker thread, so the webview only
 * awaits. Aborting the signal asks Rust to kill the engine; `renderChapter` then rejects with `CancelledError`.
 */
export function createTauriAudioRunner(
  bridge: Pick<Bridge, "audioVoices" | "audioRenderChapter" | "audioCancel">,
  root: string,
  jobId: string,
  /** The edition being read: its language and the folder its files go to (`audioDir(language)`). */
  edition: { language: string; dir: string },
): AudioRunner {
  return {
    async listVoices() {
      try {
        return await bridge.audioVoices();
      } catch (e) {
        throw mapAudioError(e);
      }
    },
    async renderChapter(req: RenderRequest, onProgress, signal) {
      const stop = () => void bridge.audioCancel(jobId).catch(() => undefined);
      if (signal.aborted) stop();
      else signal.addEventListener("abort", stop, { once: true });
      try {
        // M4B is one file for the whole book: chapters only leave a lossless part for it, never a file of their own.
        const part = req.formats.includes("m4b")
          ? chapterPart(edition.language, req.chapterId)
          : undefined;
        const rendered = await bridge.audioRenderChapter(
          {
            jobId,
            root,
            base: chapterBase(edition.dir, req.chapterIndex, req.title),
            chunks: req.chunks,
            voice: req.voice,
            speed: req.speed,
            formats: req.formats.filter((f) => f !== "m4b"),
            ...(part ? { part } : {}),
          },
          onProgress,
        );
        return part ? { ...rendered, part } : rendered;
      } catch (e) {
        throw mapAudioError(e);
      } finally {
        signal.removeEventListener("abort", stop);
      }
    },
  };
}
