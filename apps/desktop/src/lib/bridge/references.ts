import { invoke } from "@tauri-apps/api/core";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import type { ReferenceKind } from "../references/referenceKinds";
import { binary, type RawBytes } from "./types";

/** What `import_reference` reports (`ImportedReference` in src-tauri/src/project/references.rs). */
export interface ImportedReference {
  file: string;
  title: string;
  size: number;
  kind: ReferenceKind;
  /** An identical file was already in `references/`, so no copy was made. */
  reused: boolean;
}

/** Reference files in the project's `references/`. */
export const referencesBridge = {
  /** Copies the picked file into `references/`; resolves to where it went. The path is only used once, never stored. */
  importReference: (root: string, source: string) =>
    invoke<ImportedReference>("import_reference", { root, source }),
  statReference: (root: string, path: string) =>
    invoke<{ size: number; kind: ReferenceKind }>("stat_reference", { root, path }),
  /** Up to `length` bytes (the backend caps one call at 16 MB) of `references/<name>` from `offset`. */
  readReference: (
    root: string,
    path: string,
    offset: number,
    length: number,
  ): Promise<Uint8Array> =>
    binary(invoke<RawBytes>("read_reference", { root, path, offset, length })),
  /**
   * A URL a `<video>` or `<audio>` can stream from (the `cadabra-ref` scheme, which answers range requests), or null
   * when the host has no such scheme (the browser dev server and the Playwright fake backend). Audio and video only.
   */
  referenceStreamUrl: (root: string, path: string) =>
    invoke<string | null>("reference_stream_url", { root, path }),
  /** Moves the file to `.cadabra/trash`; resolves to the trash path. */
  trashReference: (root: string, path: string) => invoke<string>("trash_reference", { root, path }),
  /** Opens the file in the operating system's default app (never a program, script, web page or SVG). */
  openReference: (root: string, path: string) => invoke<void>("open_reference", { root, path }),
  /** Calls back with the absolute paths of files dropped on the window. Returns an unsubscribe function. */
  onFilesDropped: (cb: (paths: string[]) => void): Promise<() => void> =>
    getCurrentWebview().onDragDropEvent((e) => {
      if (e.payload.type === "drop") cb(e.payload.paths);
    }),
};
