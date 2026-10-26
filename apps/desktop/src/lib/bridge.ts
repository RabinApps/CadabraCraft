import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import { IMAGE_EXTENSIONS } from "@cadabracraft/shared";

export interface FileRead { contents: string; hash: string }
export interface WriteResult { hash: string; conflict_copy: string | null }

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
  /** Where typst is and its version; rejects with `{ kind: "not_found", message }` (install advice) when missing. `typstPath` is a user-configured location. */
  typstFind: (typstPath: string | null) => invoke<{ path: string; version: string }>("typst_find", { typstPath }),
  typstListFonts: (typstPath: string | null) => invoke<string[]>("typst_list_fonts", { typstPath }),
  /** Compiles Typst source plus asset files (name, bytes) to PDF bytes. */
  typstCompile: async (typstPath: string | null, source: string, files: [string, number[]][], pdfA: boolean): Promise<Uint8Array> => {
    const r = await invoke<ArrayBuffer | number[]>("typst_compile", { typstPath, source, files, pdfA });
    return r instanceof ArrayBuffer ? new Uint8Array(r) : Uint8Array.from(r);
  },
};
export type Bridge = typeof bridge;
