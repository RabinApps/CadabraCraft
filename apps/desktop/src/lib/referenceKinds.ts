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
