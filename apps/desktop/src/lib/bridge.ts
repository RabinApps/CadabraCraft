import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";

export interface FileRead { contents: string; hash: string }
export interface WriteResult { hash: string; conflict_copy: string | null }

/** Thin wrapper over the Tauri commands in src-tauri/src/commands. All paths are relative to the project root. */
export const bridge = {
  pickFolder: async (): Promise<string | null> => {
    const r = await open({ directory: true, multiple: false });
    return typeof r === "string" ? r : null;
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
};
export type Bridge = typeof bridge;
