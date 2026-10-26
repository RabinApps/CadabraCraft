import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import { IMAGE_EXTENSIONS } from "@cadabracraft/shared";

export interface FileRead { contents: string; hash: string }
export interface WriteResult { hash: string; conflict_copy: string | null }

const binary = async (p: Promise<ArrayBuffer | number[]>): Promise<Uint8Array> => {
  const r = await p;
  return r instanceof ArrayBuffer ? new Uint8Array(r) : Uint8Array.from(r);
};

/** Thin wrapper over the Tauri commands in src-tauri/src/commands. All paths are relative to the project root. */
export const bridge = {
  pickFolder: async (): Promise<string | null> => {
    const r = await open({ directory: true, multiple: false });
    return typeof r === "string" ? r : null;
  },
  /** Native file picker for one image; returns its absolute path (only ever passed to `importAsset`, never stored). */
  pickImage: async (): Promise<string | null> => {
    const r = await open({ multiple: false, directory: false, filters: [{ name: "Images", extensions: IMAGE_EXTENSIONS }] });
    return typeof r === "string" ? r : null;
  },
  /** Copies the picked image into the project's `assets/`; resolves to the project-relative path (`assets/<name>`). */
  importAsset: (root: string, source: string) => invoke<string>("import_asset", { root, source }),
  /** Bytes of `assets/<image>`, for display and export. */
  readAsset: async (root: string, path: string): Promise<Uint8Array> => {
    const r = await invoke<ArrayBuffer | number[]>("read_asset", { root, path });
    return r instanceof ArrayBuffer ? new Uint8Array(r) : Uint8Array.from(r);
  },
  /** Native file picker for a document to import; returns its absolute path (read-only, never stored in a project). */
  pickImportSource: async (): Promise<string | null> => {
    const r = await open({ multiple: false, directory: false, filters: [{ name: "Documents", extensions: ["docx", "md", "markdown"] }] });
    return typeof r === "string" ? r : null;
  },
  /** Bytes of the picked document (docx/md/markdown/txt, at most 200 MB). */
  readImportSource: (path: string) => binary(invoke<ArrayBuffer | number[]>("read_import_source", { path })),
  /** Bytes of an image a Markdown file references, resolved inside that file's folder (rejects `..`, absolute paths, symlink escapes). */
  readImportImage: (sourceFile: string, reference: string) => binary(invoke<ArrayBuffer | number[]>("read_import_image", { sourceFile, reference })),
  /** Stores image bytes from an imported document in `assets/`; resolves to the path actually used (`assets/<name>`). */
  importAssetBytes: (root: string, name: string, bytes: Uint8Array) => invoke<string>("import_asset_bytes", { root, name, bytes: Array.from(bytes) }),
  createProject: (root: string, manifestJson: string) => invoke<void>("create_project", { root, manifestJson }),
  readFile: (root: string, path: string) => invoke<FileRead | null>("read_project_file", { root, path }),
  writeFile: (root: string, path: string, contents: string, baseHash: string | null) =>
    invoke<WriteResult>("write_project_file", { root, path, contents, baseHash }),
  writeBytes: (root: string, path: string, bytes: number[]) => invoke<void>("write_project_bytes", { root, path, bytes }),
  backupManifest: (root: string) => invoke<string>("backup_manifest", { root }),
  watchProject: (root: string) => invoke<void>("watch_project", { root }),
  /** Calls back with the project-relative path of each file changed outside the app. Returns an unsubscribe function. */
  onProjectChanged: (cb: (path: string) => void) => listen<string>("project-changed", (e) => cb(e.payload)).then((un) => un),
  trashFile: (root: string, path: string) => invoke<string>("trash_project_file", { root, path }),
};
export type Bridge = typeof bridge;
