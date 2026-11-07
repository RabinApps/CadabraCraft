import { invoke } from "@tauri-apps/api/core";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import type { FileKind } from "../references/referenceKinds";
import { binary, type RawBytes } from "./types";

/** A point in the page, in CSS pixels from the top left of the viewport. */
export interface DropPoint {
  x: number;
  y: number;
}

/** Tauri reports drag positions in physical pixels; the page's coordinates are CSS pixels. */
const cssPoint = (p: DropPoint): DropPoint => {
  const scale = globalThis.devicePixelRatio || 1;
  return { x: p.x / scale, y: p.y / scale };
};

/** What `import_reference` reports (`ImportedReference` in src-tauri/src/project/references.rs). */
export interface ImportedReference {
  file: string;
  title: string;
  size: number;
  kind: FileKind;
  /** An identical file was already in `references/`, so no copy was made. */
  reused: boolean;
}

/** Reference files in the project's `references/`. */
export const referencesBridge = {
  /** Copies the picked file into `references/`; resolves to where it went. The path is only used once, never stored. */
  importReference: (root: string, source: string) =>
    invoke<ImportedReference>("import_reference", { root, source }),
  statReference: (root: string, path: string) =>
    invoke<{ size: number; kind: FileKind }>("stat_reference", { root, path }),
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
  /** Opens an http or https address in the default browser. The backend refuses any other address. */
  openReferenceUrl: (url: string) => invoke<void>("open_reference_url", { url }),
  /**
   * Follows files dragged over the window: `active(true, at)` while they are over it and `active(false)` when they leave or
   * are dropped, `drop` with their absolute paths. `at` is where the pointer is, in CSS pixels of the page (Tauri reports
   * physical pixels), so a handler can tell which part of the page the files are over. Returns an unsubscribe function.
   */
  onFileDrag: (handlers: {
    active: (over: boolean, at?: DropPoint) => void;
    drop: (paths: string[], at: DropPoint) => void;
  }): Promise<() => void> =>
    getCurrentWebview().onDragDropEvent((e) => {
      const p = e.payload;
      const at = p.type === "leave" ? undefined : cssPoint(p.position);
      handlers.active(p.type === "enter" || p.type === "over", at);
      if (p.type === "drop") handlers.drop(p.paths, at!);
    }),
};
