export class AudioExportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AudioExportError";
  }
}

/** The chapter holds a node the narrator does not know. Content is never silently dropped. */
export class UnsupportedNodeError extends AudioExportError {
  constructor(public readonly nodeType: string) {
    super(`Cannot read "${nodeType}" aloud: the audiobook exporter does not know this node type.`);
    this.name = "UnsupportedNodeError";
  }
}

export class VoiceNotInstalledError extends AudioExportError {
  constructor(public readonly voice: string) {
    super(`The voice "${voice}" is not installed. Download voices in Settings, Audio.`);
    this.name = "VoiceNotInstalledError";
  }
}

export class EngineNotFoundError extends AudioExportError {
  constructor(searched: string) {
    super(
      `The voice engine was not found (${searched}). Reinstall CadabraCraft or set its location.`,
    );
    this.name = "EngineNotFoundError";
  }
}

/** The engine ran and failed; `detail` is its own message, shown under "Show details". */
export class SynthesisError extends AudioExportError {
  constructor(public readonly detail: string) {
    super(`The voice engine failed:\n${detail.trim()}`);
    this.name = "SynthesisError";
  }
}

export class EncodeError extends AudioExportError {
  constructor(
    public readonly format: string,
    public readonly detail: string,
  ) {
    super(`Could not write ${format.toUpperCase()}:\n${detail.trim()}`);
    this.name = "EncodeError";
  }
}

export class AudioTimeoutError extends AudioExportError {
  constructor(public readonly seconds: number) {
    super(`The voice engine did not finish within ${seconds} seconds and was stopped.`);
    this.name = "AudioTimeoutError";
  }
}

export class DiskFullError extends AudioExportError {
  constructor() {
    super("There is not enough disk space to write the audiobook.");
    this.name = "DiskFullError";
  }
}

/** A voice download failed (network or server). What was fetched is kept, so trying again resumes it. */
export class DownloadError extends AudioExportError {
  constructor(public readonly detail: string) {
    super(`The voice download failed: ${detail}`);
    this.name = "DownloadError";
  }
}

/** A downloaded voice file did not match its pinned hash and was deleted. */
export class ChecksumError extends AudioExportError {
  constructor(public readonly file: string) {
    super(`The downloaded file ${file} was damaged and was deleted. Try the download again.`);
    this.name = "ChecksumError";
  }
}

/** The author pressed Cancel. Finished chapters are kept. */
export class CancelledError extends AudioExportError {
  constructor() {
    super("The audiobook export was cancelled.");
    this.name = "CancelledError";
  }
}

/** A chapter failed part-way. Earlier chapters are finished and kept; `cause` says why (an `AudioExportError`). */
export class ChapterRenderError extends AudioExportError {
  constructor(
    public readonly chapterIndex: number,
    public readonly chapterTitle: string,
    public readonly cause: AudioExportError,
  ) {
    super(`Chapter ${chapterIndex + 1}, ${chapterTitle}: ${cause.message}`);
    this.name = "ChapterRenderError";
  }
}
