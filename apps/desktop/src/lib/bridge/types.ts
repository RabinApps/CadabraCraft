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
}

/** A downloadable set of voices (`PackInfo` in src-tauri/src/audio_voices.rs). `bytes` is the download size. */
export interface VoicePack {
  id: string;
  voices: string[];
  bytes: number;
  installed: boolean;
}

export interface FileRead { contents: string; hash: string }
export interface TrashEntry { path: string; original: string; trashed_at: string }
/** An earlier version of a page: `path` is its file under `.cadabra/backups`, `at` is `YYYYMMDD-HHMM` in UTC. */
export interface SnapshotEntry { path: string; at: string }
/** A page whose newest snapshot is newer than the page itself and differs from it. */
export interface StalePage { path: string; snapshot: string }
export interface WriteResult { hash: string; conflict_copy: string | null }

/** What `invoke` hands back for binary commands: an ArrayBuffer for raw responses, a number array for JSON ones. */
export type RawBytes = ArrayBuffer | ArrayLike<number>;

/** The one place that turns an `invoke` byte result into a `Uint8Array`. */
export const toBytes = (r: RawBytes): Uint8Array => (r instanceof ArrayBuffer ? new Uint8Array(r) : Uint8Array.from(r));

/** Awaits a binary `invoke` and returns its bytes. */
export const binary = async (p: Promise<RawBytes>): Promise<Uint8Array> => toBytes(await p);
