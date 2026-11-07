import { invoke } from "@tauri-apps/api/core";

/** One book a folder scan found (`ScannedBook` in src-tauri/src/project/library.rs). `root` is absolute: an app preference, never a project file. */
export interface ScannedBookRow {
  root: string;
  title: string;
  author: string;
  language: string;
  cover: string | null;
  series: string | null;
  seriesNumber: string | null;
}

/** What a folder scan returned (`LibraryScan`). */
export interface LibraryScanResult {
  books: ScannedBookRow[];
  /** Folders with a manifest that could not be read as a book. */
  skipped: number;
  /** The scan stopped at a limit, so the list may be incomplete. */
  truncated: boolean;
}

/** Size and modification time (ms) of an asset, to tell whether a cached thumbnail is still the picture. */
export interface AssetStamp {
  size: number;
  modified: number;
}

/** The Library: finding books in a folder, and cover stamps. */
export const libraryBridge = {
  /** Native folder picker for a folder of books; the folder can then be passed to `scanLibrary`. Null on cancel. */
  pickLibraryFolder: () => invoke<string | null>("pick_library_folder"),
  /** Lists the books (manifest fields only) under a folder picked with `pickLibraryFolder`. Rejects with `not_picked` for any other folder. */
  scanLibrary: (root: string) => invoke<LibraryScanResult>("scan_library", { root }),
  /** Size and modification time of `assets/<image>`. Rejects when the file is gone. */
  statAsset: (root: string, path: string) => invoke<AssetStamp>("stat_asset", { root, path }),
};
