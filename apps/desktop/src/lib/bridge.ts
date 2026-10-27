import { Channel, invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";
import { relaunch } from "@tauri-apps/plugin-process";
import { check, type Update } from "@tauri-apps/plugin-updater";
import type { Chunk, RenderedChapter, VoiceInfo } from "@cadabracraft/export-audio";
import { IMAGE_EXTENSIONS } from "@cadabracraft/shared";
import { packCompileRequest } from "./compileFrame";

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

const binary = async (p: Promise<RawBytes>): Promise<Uint8Array> => toBytes(await p);

/**
 * Dev-automation only: an agent can queue answers for the next native dialogs (see src-tauri/src/automation.rs).
 * Returns undefined when nothing is queued, in production builds, or when the command doesn't exist, so the real
 * dialog opens. Returns null when the queued answer is "cancel".
 */
const queuedDialog = async (): Promise<string | null | undefined> => {
  if (!import.meta.env.DEV) return undefined;
  try {
    const r = await invoke<{ answer: string | null } | null>("automation_take_dialog");
    return r ? r.answer : undefined;
  } catch {
    return undefined;
  }
};

/** Thin wrapper over the Tauri commands in src-tauri/src/commands. All paths are relative to the project root. */
export const bridge = {
  pickFolder: async (): Promise<string | null> => {
    const queued = await queuedDialog();
    if (queued !== undefined) return queued;
    const r = await open({ directory: true, multiple: false });
    return typeof r === "string" ? r : null;
  },
  /** Native file picker for one image; returns its absolute path (only ever passed to `importAsset`, never stored). */
  pickImage: async (): Promise<string | null> => {
    const queued = await queuedDialog();
    if (queued !== undefined) return queued;
    const r = await open({ multiple: false, directory: false, filters: [{ name: "Images", extensions: IMAGE_EXTENSIONS }] });
    return typeof r === "string" ? r : null;
  },
  /** Copies the picked image into the project's `assets/`; resolves to the project-relative path (`assets/<name>`). */
  importAsset: (root: string, source: string) => invoke<string>("import_asset", { root, source }),
  /** Bytes of `assets/<image>`, for display and export. */
  readAsset: (root: string, path: string): Promise<Uint8Array> => binary(invoke<RawBytes>("read_asset", { root, path })),
  /** Native file picker for a document to import; returns its absolute path (read-only, never stored in a project). */
  pickImportSource: async (): Promise<string | null> => {
    const queued = await queuedDialog();
    if (queued !== undefined) return queued;
    const r = await open({ multiple: false, directory: false, filters: [{ name: "Documents", extensions: ["docx", "md", "markdown", "html", "htm"] }] });
    return typeof r === "string" ? r : null;
  },
  /** Bytes of the picked document (docx/md/markdown/html/htm/txt, at most 200 MB). */
  readImportSource: (path: string) => binary(invoke<RawBytes>("read_import_source", { path })),
  /** Bytes of an image a Markdown file references, resolved inside that file's folder (rejects `..`, absolute paths, symlink escapes). */
  readImportImage: (sourceFile: string, reference: string) => binary(invoke<RawBytes>("read_import_image", { sourceFile, reference })),
  /** Stores image bytes from an imported document in `assets/`; resolves to the path actually used (`assets/<name>`). */
  importAssetBytes: (root: string, name: string, bytes: Uint8Array) => invoke<string>("import_asset_bytes", { root, name, bytes: Array.from(bytes) }),
  /** Opens a web address in the author's default browser (the opener plugin only allows the sponsor page, see capabilities/default.json). */
  openUrl: (url: string) => openUrl(url),
  /** Asks the update endpoint (GitHub Releases) for a newer version; `null` when this is the latest. The only request the app makes on its own. */
  checkForUpdate: (): Promise<Update | null> => check(),
  /** False for a Linux package that is not an AppImage: the updater cannot replace it, so no update is offered. */
  updatesSupported: () => invoke<boolean>("updates_supported"),
  /** Restarts the app once an update has been installed. */
  relaunch: () => relaunch(),
  createProject: (root: string, manifestJson: string) => invoke<void>("create_project", { root, manifestJson }),
  readFile: (root: string, path: string) => invoke<FileRead | null>("read_project_file", { root, path }),
  writeFile: (root: string, path: string, contents: string, baseHash: string | null) =>
    invoke<WriteResult>("write_project_file", { root, path, contents, baseHash }),
  /** Writes raw bytes (sent as the binary request body; `root` and `path` travel as percent-encoded headers). */
  writeBytes: (root: string, path: string, bytes: Uint8Array) =>
    invoke<void>("write_project_bytes", bytes, { headers: { root: encodeURIComponent(root), path: encodeURIComponent(path) } }),
  backupManifest: (root: string) => invoke<string>("backup_manifest", { root }),
  watchProject: (root: string) => invoke<void>("watch_project", { root }),
  /** Calls back with the project-relative path of each file changed outside the app. Returns an unsubscribe function. */
  onProjectChanged: (cb: (path: string) => void) => listen<string>("project-changed", (e) => cb(e.payload)).then((un) => un),
  trashFile: (root: string, path: string) => invoke<string>("trash_project_file", { root, path }),
  /** Restorable pages in the project trash, newest first. */
  listTrash: (root: string) => invoke<TrashEntry[]>("list_project_trash", { root }),
  /** Moves a trashed page back (never overwriting; a taken name gets `-2`...). Resolves to the project-relative path it now has. */
  restoreTrash: (root: string, path: string) => invoke<string>("restore_project_trash", { root, path }),
  /** Earlier versions of a page, newest first. The Rust layer takes one on a save, at most every 10 minutes. */
  listSnapshots: (root: string, path: string) => invoke<SnapshotEntry[]>("list_page_snapshots", { root, path }),
  readSnapshot: (root: string, path: string, snapshot: string) => invoke<FileRead>("read_page_snapshot", { root, path, snapshot }),
  /** Puts a snapshot back as the page; the text it replaces is kept as a snapshot first. */
  restoreSnapshot: (root: string, path: string, snapshot: string) => invoke<WriteResult>("restore_page_snapshot", { root, path, snapshot }),
  /** Removes old snapshots beyond `keep` per page (never ones younger than 30 days); resolves to how many were removed. */
  pruneSnapshots: (root: string, paths: string[], keep: number) => invoke<number>("prune_page_snapshots", { root, paths, keep }),
  findStalePages: (root: string, paths: string[]) => invoke<StalePage[]>("find_stale_pages", { root, paths }),
  /** Where typst is and its version; rejects with `{ kind: "not_found", message }` (install advice) when missing. `typstPath` is a user-configured location. */
  typstFind: (typstPath: string | null) => invoke<{ path: string; version: string }>("typst_find", { typstPath }),
  typstListFonts: (typstPath: string | null) => invoke<string[]>("typst_list_fonts", { typstPath }),
  /** Compiles Typst source plus asset files (name, bytes) to PDF bytes. The request travels as one binary body (see `packCompileRequest`). */
  typstCompile: (typstPath: string | null, source: string, files: readonly (readonly [string, Uint8Array])[], pdfA: boolean): Promise<Uint8Array> =>
    binary(invoke<RawBytes>("typst_compile", packCompileRequest({ typstPath, source, files, pdfA }))),
  /** Voices the audio engine knows and whether their files are installed. */
  audioVoices: () => invoke<VoiceInfo[]>("audio_voices"),
  /** Renders one chapter off the UI thread; `onProgress` gets 0..1 after every batch. Rejects with an `AudioError` shape (`{ kind, ... }`). */
  audioRenderChapter: (request: AudioChapterRequest, onProgress: (fraction: number) => void): Promise<RenderedChapter> => {
    const channel = new Channel<number>();
    channel.onmessage = onProgress;
    return invoke<RenderedChapter>("audio_render_chapter", { request, onProgress: channel });
  },
  /** The voice packs, their download sizes and whether all their files are installed. */
  audioPacks: () => invoke<VoicePack[]>("audio_packs"),
  /** Downloads a voice pack (resuming a stopped download); `onProgress` gets the bytes of the whole pack. Stop it with `audioCancel(jobId)`. */
  audioDownloadPack: (pack: string, jobId: string, onProgress: (p: { done: number; total: number }) => void): Promise<void> => {
    const channel = new Channel<{ done: number; total: number }>();
    channel.onmessage = onProgress;
    return invoke<void>("audio_download_pack", { pack, jobId, onProgress: channel });
  },
  /** A short WAV of the given chunks, rendered off the UI thread and never written to the project. Stop it with `audioCancel(jobId)`. */
  audioSample: (request: { jobId: string; chunks: Chunk[]; voice: string; speed: number }): Promise<Uint8Array> => binary(invoke<RawBytes>("audio_sample", { request })),
  audioDeletePack: (pack: string) => invoke<void>("audio_delete_pack", { pack }),
  /** Stops the job's running chapter (the engine process is killed) and every later one. */
  audioCancel: (jobId: string) => invoke<void>("audio_cancel", { jobId }),
  /** Which of these project-relative files exist (for trusting the chapter cache). */
  audioFilesExist: (root: string, paths: string[]) => invoke<boolean[]>("audio_files_exist", { root, paths }),
  /** Drops the job's cancel flag once an export has ended. */
  audioForget: (jobId: string) => invoke<void>("audio_forget", { jobId }),
};
export type Bridge = typeof bridge;
