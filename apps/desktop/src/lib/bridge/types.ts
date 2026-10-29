import type { Chunk } from "@cadabracraft/export-audio";

/** One `audio_render_chapter` call (`ChapterRequest` in src-tauri/src/audio.rs). `base` is the output path without its extension. */
export interface AudioChapterRequest {
  jobId: string;
  root: string;
  base: string;
  chunks: Chunk[];
  voice: string;
  speed: number;
  formats: string[];
  /** Also keep a lossless part here for the book's M4B (`.cadabra/audio/parts/<name>.flac`). */
  part?: string;
}

/** The whole-book M4B (`M4bRequest` in src-tauri/src/audio/m4b.rs). */
export interface AudioM4bRequest {
  jobId: string;
  root: string;
  base: string;
  title: string;
  author: string;
  cover: string | null;
  chapters: { title: string; part: string; durationSec: number }[];
}

/** A downloadable set of voices (`PackInfo` in src-tauri/src/audio_voices.rs). `bytes` is the download size. */
export interface VoicePack {
  id: string;
  voices: string[];
  bytes: number;
  installed: boolean;
}

export interface FileRead {
  contents: string;
  hash: string;
}
export interface TrashEntry {
  path: string;
  original: string;
  trashed_at: string;
}
/** An earlier version of a page: `path` is its file under `.cadabra/backups`, `at` is `YYYYMMDD-HHMM` in UTC. */
export interface SnapshotEntry {
  path: string;
  at: string;
}
/** A page whose newest snapshot is newer than the page itself and differs from it. */
export interface StalePage {
  path: string;
  snapshot: string;
}
/** A snapshot of the whole book: `path` is its file under `.cadabra/snapshots`, `at` is `YYYYMMDD-HHMM` in UTC. */
export interface BookSnapshotEntry {
  path: string;
  at: string;
  name: string;
  /** Taken by the app before a restore, not named by the author. */
  automatic: boolean;
  /** Project-relative paths of the pages it holds. */
  pages: string[];
  /** How many image files it lists (the files themselves are not copied). */
  assets: number;
  bytes: number;
}
/** What restoring a whole book did. */
export interface BookRestore {
  /** The automatic snapshot of the book as it was just before. */
  safety: string;
  written: string[];
  /** Pages the snapshot did not have; they are in the trash now. */
  trashed: string[];
  /** Image files the snapshot lists that are no longer in `assets/`. */
  missing_assets: string[];
}
export interface WriteResult {
  hash: string;
  conflict_copy: string | null;
}

/** What `invoke` hands back for binary commands: an ArrayBuffer for raw responses, a number array for JSON ones. */
export type RawBytes = ArrayBuffer | ArrayLike<number>;

/** The one place that turns an `invoke` byte result into a `Uint8Array`. */
export const toBytes = (r: RawBytes): Uint8Array =>
  r instanceof ArrayBuffer ? new Uint8Array(r) : Uint8Array.from(r);

/** Awaits a binary `invoke` and returns its bytes. */
export const binary = async (p: Promise<RawBytes>): Promise<Uint8Array> => toBytes(await p);

/** A font family in the download catalog (`FontPackInfo` in src-tauri/src/fonts/catalog.rs). `bytes` is the download size. */
export interface FontPack {
  id: string;
  family: string;
  styles: string[];
  bytes: number;
  installed: boolean;
  /** Short licence name, for example "OFL-1.1". */
  licence: string;
  licenceUrl: string;
}

/** A font family kept by the app, downloaded or imported (`InstalledFont` in src-tauri/src/fonts/store.rs). `files` are names, never paths. */
export interface InstalledFont {
  id: string;
  family: string;
  source: "downloaded" | "imported";
  files: string[];
}
