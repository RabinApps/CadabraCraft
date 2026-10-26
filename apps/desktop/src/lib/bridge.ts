import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";
import { relaunch } from "@tauri-apps/plugin-process";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { IMAGE_EXTENSIONS } from "@cadabracraft/shared";
import { packCompileRequest } from "./compileFrame";

export interface FileRead { contents: string; hash: string }
export interface TrashEntry { path: string; original: string; trashed_at: string }
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
    const r = await open({ multiple: false, directory: false, filters: [{ name: "Documents", extensions: ["docx", "md", "markdown"] }] });
    return typeof r === "string" ? r : null;
  },
  /** Bytes of the picked document (docx/md/markdown/txt, at most 200 MB). */
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
  /** Where typst is and its version; rejects with `{ kind: "not_found", message }` (install advice) when missing. `typstPath` is a user-configured location. */
  typstFind: (typstPath: string | null) => invoke<{ path: string; version: string }>("typst_find", { typstPath }),
  typstListFonts: (typstPath: string | null) => invoke<string[]>("typst_list_fonts", { typstPath }),
  /** Compiles Typst source plus asset files (name, bytes) to PDF bytes. The request travels as one binary body (see `packCompileRequest`). */
  typstCompile: (typstPath: string | null, source: string, files: readonly (readonly [string, Uint8Array])[], pdfA: boolean): Promise<Uint8Array> =>
    binary(invoke<RawBytes>("typst_compile", packCompileRequest({ typstPath, source, files, pdfA }))),
};
export type Bridge = typeof bridge;
