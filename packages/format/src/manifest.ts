import { isBackMatterKind, isFrontMatterKind, type MatterKind } from "@cadabracraft/shared";

export const CURRENT_FORMAT_VERSION = 2;

export interface ManuscriptEntry {
  id: string;
  /** Relative path inside the project, using "/". */
  file: string;
  title: string;
  /** Front and back matter pages only (formatVersion 2): what the page is, for starter content and export semantics. */
  kind?: MatterKind;
}

export interface Manifest {
  formatVersion: number;
  title: string;
  author: string;
  language: string;
  identifier: string;
  template: string;
  isbn: string | null;
  frontMatter: ManuscriptEntry[];
  chapters: ManuscriptEntry[];
  backMatter: ManuscriptEntry[];
}

export class FormatError extends Error {}

/** True for paths that stay inside the project: relative, "/" separated, no "..", no drive letters. */
export function isSafeRelativePath(p: string): boolean {
  if (!p || p.startsWith("/") || p.includes("\\") || /^[A-Za-z]:/.test(p)) return false;
  return p.split("/").every((seg) => seg !== "" && seg !== ".." && seg !== ".");
}

export function createManifest(init: { title: string; author: string; language?: string; identifier: string; template?: string }): Manifest {
  return {
    formatVersion: CURRENT_FORMAT_VERSION,
    title: init.title,
    author: init.author,
    language: init.language ?? "en",
    identifier: init.identifier,
    template: init.template ?? "novel",
    isbn: null,
    frontMatter: [],
    chapters: [],
    backMatter: [],
  };
}

/** Reading order: front matter, chapters, back matter. */
export function readingOrder(m: Manifest): ManuscriptEntry[] {
  return [...m.frontMatter, ...m.chapters, ...m.backMatter];
}

const str = (v: unknown, name: string): string => {
  if (typeof v !== "string" || v === "") throw new FormatError(`manifest: "${name}" must be a non-empty string`);
  return v;
};

function entries(v: unknown, name: string, section: "front" | "chapter" | "back"): ManuscriptEntry[] {
  if (!Array.isArray(v)) throw new FormatError(`manifest: "${name}" must be an array`);
  return v.map((e, i) => {
    const o = (e ?? {}) as Record<string, unknown>;
    const file = str(o.file, `${name}[${i}].file`);
    if (!isSafeRelativePath(file)) throw new FormatError(`manifest: unsafe path "${file}" in ${name}[${i}]`);
    const entry: ManuscriptEntry = { id: str(o.id, `${name}[${i}].id`), file, title: str(o.title, `${name}[${i}].title`) };
    if (o.kind !== undefined) {
      const ok = section === "front" ? isFrontMatterKind(o.kind) : section === "back" && isBackMatterKind(o.kind);
      if (!ok) throw new FormatError(`manifest: invalid kind ${JSON.stringify(o.kind)} in ${name}[${i}]`);
      entry.kind = o.kind as MatterKind;
    }
    return entry;
  });
}

/** Validates an already-migrated manifest object. Throws FormatError on any problem. */
export function validateManifest(raw: unknown, version = CURRENT_FORMAT_VERSION): Manifest {
  const o = (raw ?? {}) as Record<string, unknown>;
  if (o.formatVersion !== version) throw new FormatError(`manifest: unsupported formatVersion ${String(o.formatVersion)}`);
  const m: Manifest = {
    formatVersion: version,
    title: str(o.title, "title"),
    author: str(o.author, "author"),
    language: str(o.language, "language"),
    identifier: str(o.identifier, "identifier"),
    template: str(o.template, "template"),
    isbn: o.isbn == null ? null : str(o.isbn, "isbn"),
    frontMatter: entries(o.frontMatter, "frontMatter", "front"),
    chapters: entries(o.chapters, "chapters", "chapter"),
    backMatter: entries(o.backMatter, "backMatter", "back"),
  };
  const seen = new Set<string>();
  for (const e of readingOrder(m)) {
    if (seen.has(e.id)) throw new FormatError(`manifest: duplicate id "${e.id}"`);
    seen.add(e.id);
  }
  return m;
}

export const serializeManifest = (m: Manifest): string => JSON.stringify(m, null, 2) + "\n";
