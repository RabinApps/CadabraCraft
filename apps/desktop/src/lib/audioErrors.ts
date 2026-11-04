import { t } from "@lingui/core/macro";
import {
  AudioTimeoutError,
  CancelledError,
  ChapterRenderError,
  ChecksumError,
  DownloadError,
  DiskFullError,
  EncodeError,
  EngineNotFoundError,
  SynthesisError,
  VoiceNotInstalledError,
} from "@cadabracraft/export-audio";
import { errText } from "./projectError";

export type AudioErrorCode =
  | "download"
  | "voice-missing"
  | "engine-missing"
  | "engine-failed"
  | "encode"
  | "disk-full"
  | "timeout"
  | "cancelled"
  | "other";

/** An audiobook failure with a message written for the author and a code the dialog can act on. */
export class AudioUiError extends Error {
  constructor(
    public readonly code: AudioErrorCode,
    message: string,
    /** Zero-based chapter that stopped, when the failure happened inside one. */
    public readonly chapterIndex?: number,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = "AudioUiError";
  }
}

function reason(e: unknown): { code: AudioErrorCode; text: string } {
  if (e instanceof VoiceNotInstalledError)
    return {
      code: "voice-missing",
      text: t`the voice "${e.voice}" is not installed. Download it in Settings, or choose another voice`,
    };
  if (e instanceof EngineNotFoundError)
    return {
      code: "engine-missing",
      text: t`the voice engine that comes with CadabraCraft is missing. Reinstall the app.`,
    };
  if (e instanceof SynthesisError)
    return {
      code: "engine-failed",
      text: t`the voice engine stopped:\n${e.detail.trim()}\nTry again, or choose another voice`,
    };
  if (e instanceof EncodeError)
    return {
      code: "encode",
      text: t`${e.format.toUpperCase()} could not be written:\n${e.detail.trim()}\nCheck the folder can be written to and try again`,
    };
  if (e instanceof DownloadError)
    return {
      code: "download",
      text: t`the download failed: ${e.detail}. What was downloaded is kept, so you can try again.`,
    };
  if (e instanceof ChecksumError)
    return {
      code: "download",
      text: t`the downloaded file ${e.file} was damaged and was deleted. Try the download again`,
    };
  if (e instanceof DiskFullError)
    return {
      code: "disk-full",
      text: t`there is not enough disk space. Free some space and try again`,
    };
  if (e instanceof AudioTimeoutError)
    return {
      code: "timeout",
      text: t`the voice engine took longer than ${e.seconds} seconds and was stopped. Try again, or export fewer chapters`,
    };
  return { code: "other", text: t`${errText(e)}. Try again` };
}

/** Maps export-audio errors to translated, actionable messages. A failure inside a chapter names the chapter. */
export function describeAudioError(e: unknown): AudioUiError {
  if (e instanceof AudioUiError) return e;
  if (e instanceof CancelledError)
    return new AudioUiError(
      "cancelled",
      t`The audiobook was cancelled. Chapters that were finished are kept.`,
      undefined,
      { cause: e },
    );
  if (e instanceof ChapterRenderError) {
    if (e.cause instanceof CancelledError) return describeAudioError(e.cause);
    const { code, text } = reason(e.cause);
    const n = e.chapterIndex + 1;
    return new AudioUiError(
      code,
      t`Chapter ${n}, ${e.chapterTitle}, stopped: ${text}`,
      e.chapterIndex,
      { cause: e },
    );
  }
  const { code, text } = reason(e);
  return new AudioUiError(code, text.charAt(0).toUpperCase() + text.slice(1), undefined, {
    cause: e,
  });
}
