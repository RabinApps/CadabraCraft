import type { Reference } from "@cadabracraft/format";

/** What a reference file is, which decides how it is shown (mirrors `ReferenceKind` in src-tauri/src/project/references.rs). */
export type ReferenceKind = "image" | "video" | "audio" | "pdf" | "text" | "other";

const BY_EXT: Record<string, ReferenceKind> = {
  png: "image",
  jpg: "image",
  jpeg: "image",
  gif: "image",
  webp: "image",
  svg: "image",
  mp4: "video",
  m4v: "video",
  mov: "video",
  webm: "video",
  mp3: "audio",
  wav: "audio",
  ogg: "audio",
  oga: "audio",
  m4a: "audio",
  flac: "audio",
  pdf: "pdf",
  txt: "text",
  md: "text",
  markdown: "text",
};

const MEDIA_TYPES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
  mp4: "video/mp4",
  m4v: "video/mp4",
  mov: "video/quicktime",
  webm: "video/webm",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  ogg: "audio/ogg",
  oga: "audio/ogg",
  m4a: "audio/mp4",
  flac: "audio/flac",
  pdf: "application/pdf",
  txt: "text/plain",
  md: "text/markdown",
  markdown: "text/markdown",
};

const extOf = (file: string): string => {
  const dot = file.lastIndexOf(".");
  return dot < 0 || file.indexOf("/", dot) >= 0 ? "" : file.slice(dot + 1).toLowerCase();
};

export const referenceKind = (file: string): ReferenceKind => BY_EXT[extOf(file)] ?? "other";

export const referenceMediaType = (file: string): string =>
  MEDIA_TYPES[extOf(file)] ?? "application/octet-stream";

/** "812 B", "12 KB", "3.2 MB", "48 MB", "1.4 GB". */
export function formatSize(bytes: number): string {
  const unit = (n: number, u: string) =>
    `${n >= 10 ? Math.round(n) : Math.round(n * 10) / 10} ${u}`;
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return unit(bytes / 1024, "KB");
  if (bytes < 1024 ** 3) return unit(bytes / 1024 ** 2, "MB");
  return unit(bytes / 1024 ** 3, "GB");
}

export interface ReferenceFilter {
  query: string;
  kind: ReferenceKind | "all";
  tag: string | null;
}

export const NO_FILTER: ReferenceFilter = { query: "", kind: "all", tag: null };

/** The references that match a search text (title, note, tags and file name), a kind and a tag, in list order. */
export function filterReferences(refs: Reference[], f: ReferenceFilter): Reference[] {
  const q = f.query.trim().toLowerCase();
  return refs.filter(
    (r) =>
      (f.kind === "all" || referenceKind(r.file) === f.kind) &&
      (f.tag === null || r.tags.includes(f.tag)) &&
      (q === "" ||
        [r.title, r.note, r.file, ...r.tags].some((text) => text.toLowerCase().includes(q))),
  );
}

/** Every tag in use, alphabetical. */
export const allTags = (refs: Reference[]): string[] =>
  [...new Set(refs.flatMap((r) => r.tags))].sort((a, b) => a.localeCompare(b));

/** True when the list shows every reference, so its order can be changed (a search, type or tag filter hides some). */
export const canReorder = (f: ReferenceFilter): boolean =>
  f.query.trim() === "" && f.kind === "all" && f.tag === null;

/** Where a dragged row would land: the number of rows whose middle is above `y` (0 = before the first row). */
export const insertionIndex = (middles: number[], y: number): number =>
  middles.filter((m) => m < y).length;

/** The list position a row ends up at when it is dropped at insertion point `at` (the row's own removal shifts later points up). */
export const dropPosition = (from: number, at: number): number => (at > from ? at - 1 : at);

/** How the list is shown. "manual" is the saved order (the one reordering changes); the others are views and never change it. */
export type SortKey = "manual" | "title-asc" | "title-desc" | "newest" | "oldest" | "kind";

const KIND_ORDER: ReferenceKind[] = ["image", "video", "pdf", "audio", "text", "other"];
const byTitle = (a: Reference, b: Reference) =>
  a.title.localeCompare(b.title, undefined, { numeric: true, sensitivity: "base" });

/** The references in the order of `key`; ties keep the saved order. */
export function sortReferences(list: Reference[], key: SortKey): Reference[] {
  const cmp: Record<SortKey, (a: Reference, b: Reference) => number> = {
    manual: () => 0,
    "title-asc": byTitle,
    "title-desc": (a, b) => byTitle(b, a),
    newest: (a, b) => Date.parse(b.addedAt) - Date.parse(a.addedAt),
    oldest: (a, b) => Date.parse(a.addedAt) - Date.parse(b.addedAt),
    kind: (a, b) =>
      KIND_ORDER.indexOf(referenceKind(a.file)) - KIND_ORDER.indexOf(referenceKind(b.file)) ||
      byTitle(a, b),
  };
  return [...list].sort(cmp[key]);
}

/** A removed reference file found in the project trash. */
export interface RemovedReference {
  /** Where it is in `.cadabra/trash`. */
  path: string;
  /** The name it had, `references/<name>`. */
  original: string;
  /** The trash time stamp (`YYYYMMDD-HHMM`). */
  stamp: string;
}

/** The reference files among the trash entries, newest removal first. */
export function removedReferences(
  entries: { path: string; original: string; trashed_at: string }[],
): RemovedReference[] {
  return entries
    .filter((e) => e.original.startsWith("references/"))
    .map((e) => ({ path: e.path, original: e.original, stamp: e.trashed_at }))
    .sort((a, b) => b.stamp.localeCompare(a.stamp));
}

/** The moment a trash stamp (`YYYYMMDD-HHMM`) names, or null when it is not one. */
export function stampDate(stamp: string): Date | null {
  const m = /^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})/.exec(stamp);
  return m ? new Date(+m[1]!, +m[2]! - 1, +m[3]!, +m[4]!, +m[5]!) : null;
}

/** A title for a restored file: its name without the extension. */
export const titleFromFile = (file: string): string =>
  (file.split("/").pop() ?? file).replace(/\.[^.]+$/, "");
