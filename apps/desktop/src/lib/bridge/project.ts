import { invoke } from "@tauri-apps/api/core";
import type {
  BookRestore,
  BookSnapshotEntry,
  FileRead,
  SnapshotEntry,
  StalePage,
  TrashEntry,
  WriteResult,
} from "./types";

/** The project folder: files, trash and page snapshots. All paths are relative to the project root. */
export const projectBridge = {
  createProject: (root: string, manifestJson: string) =>
    invoke<void>("create_project", { root, manifestJson }),
  readFile: (root: string, path: string) =>
    invoke<FileRead | null>("read_project_file", { root, path }),
  writeFile: (root: string, path: string, contents: string, baseHash: string | null) =>
    invoke<WriteResult>("write_project_file", { root, path, contents, baseHash }),
  /** Writes raw bytes (sent as the binary request body; `root` and `path` travel as percent-encoded headers). */
  writeBytes: (root: string, path: string, bytes: Uint8Array) =>
    invoke<void>("write_project_bytes", bytes, {
      headers: { root: encodeURIComponent(root), path: encodeURIComponent(path) },
    }),
  backupManifest: (root: string) => invoke<string>("backup_manifest", { root }),
  trashFile: (root: string, path: string) => invoke<string>("trash_project_file", { root, path }),
  /** Restorable pages in the project trash, newest first. */
  listTrash: (root: string) => invoke<TrashEntry[]>("list_project_trash", { root }),
  /** Moves a trashed page back (never overwriting; a taken name gets `-2`...). Resolves to the project-relative path it now has. */
  restoreTrash: (root: string, path: string) =>
    invoke<string>("restore_project_trash", { root, path }),
  /** Earlier versions of a page, newest first. The Rust layer takes one on a save, at most every 10 minutes. */
  listSnapshots: (root: string, path: string) =>
    invoke<SnapshotEntry[]>("list_page_snapshots", { root, path }),
  readSnapshot: (root: string, path: string, snapshot: string) =>
    invoke<FileRead>("read_page_snapshot", { root, path, snapshot }),
  /** Puts a snapshot back as the page; the text it replaces is kept as a snapshot first. */
  restoreSnapshot: (root: string, path: string, snapshot: string) =>
    invoke<WriteResult>("restore_page_snapshot", { root, path, snapshot }),
  /** Removes old snapshots beyond `keep` per page (never ones younger than 30 days); resolves to how many were removed. */
  pruneSnapshots: (root: string, paths: string[], keep: number) =>
    invoke<number>("prune_page_snapshots", { root, paths, keep }),
  findStalePages: (root: string, paths: string[]) =>
    invoke<StalePage[]>("find_stale_pages", { root, paths }),
  /** Snapshots of the whole book (manifest, every page, the image list), newest first. */
  listBookSnapshots: (root: string) => invoke<BookSnapshotEntry[]>("list_book_snapshots", { root }),
  /** Takes a named snapshot of the book as it is on disk. */
  createBookSnapshot: (root: string, name: string) =>
    invoke<BookSnapshotEntry>("create_book_snapshot", { root, name }),
  /** One page's text as a book snapshot holds it. */
  readBookSnapshotPage: (root: string, snapshot: string, path: string) =>
    invoke<FileRead>("read_book_snapshot_page", { root, snapshot, path }),
  /** Puts the whole book back; an automatic snapshot of the book as it is comes first. */
  restoreBookSnapshot: (root: string, snapshot: string) =>
    invoke<BookRestore>("restore_book_snapshot", { root, snapshot }),
  /** Puts one page back from a book snapshot; the text it replaces is kept as a page snapshot first. */
  restorePageFromBookSnapshot: (root: string, snapshot: string, path: string) =>
    invoke<WriteResult>("restore_page_from_book_snapshot", { root, snapshot, path }),
  deleteBookSnapshot: (root: string, snapshot: string) =>
    invoke<void>("delete_book_snapshot", { root, snapshot }),
};
