// Types for the test hooks the fake Tauri backend (fakeTauri.ts) and the specs hang on `window`.

/**
 * The arguments of an invoked command. Which fields exist depends on the command, so they are all declared and each
 * command reads only its own (the Rust side is covered by its own tests).
 */
export interface InvokeArgs {
  path: string;
  root: string;
  url: string;
  pack: string;
  fontId: string;
  srcPath: string;
  file: string;
  snapshot: string;
  reference: string;
  manifestJson: string;
  contents: string;
  paths: string[];
  options?: { filters?: { extensions?: string[] }[]; multiple?: boolean };
  source: string;
  offset: number;
  length: number;
  event: string;
  handler: number;
  request: AudioCall & SampleCall & M4bCall;
  name: string;
  bytes: number[];
  onProgress?: { onmessage?: (value: unknown) => void };
  /** The body of the commands that take raw bytes (`write_project_bytes`, `typst_compile`). */
  buffer: ArrayBuffer;
  byteOffset: number;
  subarray: (start: number, end: number) => Uint8Array;
}

export interface InvokeOptions {
  headers: Record<string, string>;
}

export type Invoke = (cmd: string, args: InvokeArgs, opts: InvokeOptions) => Promise<unknown>;

/** An `audio_render_chapter` request as the app sent it. */
export interface AudioCall {
  base: string;
  formats: string[];
  [field: string]: unknown;
}

/** An `audio_build_m4b` request as the app sent it. */
export interface M4bCall {
  base: string;
  title: string;
  chapters: { title: string; part: string; durationSec: number }[];
  [field: string]: unknown;
}

/** An `audio_sample` request as the app sent it. */
export interface SampleCall {
  chunks: unknown[];
  [field: string]: unknown;
}

/** A `typst_compile` header: the Typst source and the options. */
export interface TypstCall {
  source: string;
  pdfA: boolean;
  [field: string]: unknown;
}

export interface FakeVoice {
  id: string;
  engine: string;
  installed: boolean;
}

export interface FakeFont {
  id: string;
  family: string;
  source: string;
  files: string[];
}

export interface FakePack {
  id: string;
  voices: string[];
  bytes: number;
  installed: boolean;
}

/** An error the fake backend throws, as the Rust commands report it. */
export interface FakeError {
  kind: string;
  message: string;
}

export interface RecordedCall {
  cmd: string;
  args: InvokeArgs;
}

declare global {
  interface Window {
    __disk: Record<string, string | number[]>;
    __TAURI_INTERNALS__: {
      metadata: unknown;
      transformCallback: (cb: (e: unknown) => void) => number;
      invoke: Invoke;
    };
    __TAURI_EVENT_PLUGIN_INTERNALS__: {
      unregisterListener: (event: string, eventId: number) => void;
    };
    __opened?: string[];
    /** Reference files: what the picker returns, the bytes behind each source path, and per-name import failures. */
    __pickedRefs?: string[];
    __refFiles?: Record<string, number[]>;
    __refErrors?: Record<string, unknown>;
    /** Makes every restore from the project trash fail with "not found". */
    __restoreFails?: boolean;
    /** Sends an event to the listeners the app registered (a file drop, for example). */
    __emit?: (event: string, payload: unknown) => void;
    __failWrite?: (path: string) => boolean;
    __failBytes?: boolean;
    __importError?: string;
    __typstError?: FakeError;
    __compileError?: FakeError;
    /** The call lists are created by the first call, so they are declared present. */
    __typstCalls: TypstCall[];
    __audioVoices?: FakeVoice[];
    __audioPacks?: FakePack[];
    __audioCalls: AudioCall[];
    __audioHold?: boolean;
    __audioReject?: (reason: unknown) => void;
    __downloads?: string[];
    __downloadHold?: boolean;
    __downloadReject?: (reason: unknown) => void;
    /** Font library: the installed families, the picked file, failures and a held download (cancelled by `fonts_cancel`). */
    __fontsInstalled?: FakeFont[];
    __pickedFont?: string | null;
    __fontError?: FakeError;
    __fontImportError?: FakeError;
    __fontHold?: boolean;
    __fontReject?: (reason: unknown) => void;
    __fontDownloads?: string[];
    __fontDataCalls?: string[];
    __sampleCalls: SampleCall[];
    __m4bCalls: M4bCall[];
    __sampleError?: FakeError;
    __cadabraMenu: { run: (id: string) => boolean };
    __calls?: RecordedCall[];
    __sources?: Record<string, number[]>;
    __lat: number[];
  }
}
