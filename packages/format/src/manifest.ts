import {
  isBackMatterKind,
  isFrontMatterKind,
  isTrimSize,
  isValidEntryId,
  type MatterKind,
  type TrimSize,
} from "@cadabracraft/shared";
import { FormatError } from "./errors";
import { validateEditions } from "./editions";
import { validateReferences } from "./references";

export { FormatError, isSafeRelativePath } from "./errors";

export const CURRENT_FORMAT_VERSION = 5;

/** One language version of the book (formatVersion 4). The first edition is the source. */
export interface Edition {
  language: string;
  title: string;
  author: string;
  identifier: string;
  isbn: string | null;
  /** Relative `assets/<name>` path of this edition's cover image, or null. */
  cover: string | null;
}

/** A chapter or matter page, shared by every edition. Text and titles are per language. */
export interface EditionEntry {
  id: string;
  /** Front and back matter pages only: what the page is, for starter content and export semantics. */
  kind?: MatterKind;
  /** Language to chapter title. Has the source language. */
  titles: Record<string, string>;
  /** Language to relative project path, using "/". Has the source language. */
  files: Record<string, string>;
  /** Languages whose text is still a copy of the source or blank, waiting for translation. Absent means none. */
  untranslated?: string[];
}

/** A research file kept beside the book (formatVersion 5). The file lives in `references/`. */
export interface Reference {
  id: string;
  /** Relative `references/<name>` path. */
  file: string;
  title: string;
  note: string;
  tags: string[];
  /** Ids of the chapters or matter pages this reference is linked to. */
  chapters: string[];
  /** ISO 8601 date and time of the import. */
  addedAt: string;
}

/** Font family names the author picked; each is a family name, not a file. */
export interface BookFonts {
  body?: string;
  heading?: string;
}

export interface Manifest {
  formatVersion: number;
  editions: Edition[];
  template: string;
  /** Print page size the book is written for. Absent means the template's default. Added without a version bump: older apps ignore it. */
  trimSize?: TrimSize;
  /** Font families chosen for the book's PDF and editor. Absent means the template's fonts. Added without a version bump: older apps ignore it. */
  fonts?: BookFonts;
  frontMatter: EditionEntry[];
  chapters: EditionEntry[];
  backMatter: EditionEntry[];
  references: Reference[];
}

export function createManifest(init: {
  title: string;
  author: string;
  language?: string;
  identifier: string;
  template?: string;
  trimSize?: TrimSize;
  fonts?: BookFonts;
}): Manifest {
  return {
    formatVersion: CURRENT_FORMAT_VERSION,
    editions: [
      {
        language: init.language ?? "en",
        title: init.title,
        author: init.author,
        identifier: init.identifier,
        isbn: null,
        cover: null,
      },
    ],
    template: init.template ?? "novel",
    ...(init.trimSize ? { trimSize: init.trimSize } : {}),
    ...(init.fonts ? { fonts: validateFonts(init.fonts) } : {}),
    frontMatter: [],
    chapters: [],
    backMatter: [],
    references: [],
  };
}

/** Reading order: front matter, chapters, back matter. */
export function readingOrder(m: Manifest): EditionEntry[] {
  return [...m.frontMatter, ...m.chapters, ...m.backMatter];
}

const COVER_PATH = /^assets\/[A-Za-z0-9_-]+\.(png|jpe?g|webp)$/;

const str = (v: unknown, name: string): string => {
  if (typeof v !== "string" || v === "")
    throw new FormatError(`manifest: "${name}" must be a non-empty string`);
  return v;
};

function cover(v: unknown, name = "cover"): string {
  const p = str(v, name);
  if (!COVER_PATH.test(p))
    throw new FormatError(
      `manifest: cover must be assets/<name> with a png, jpg or webp extension, got "${p}"`,
    );
  return p;
}

function editions(v: unknown): Edition[] {
  if (!Array.isArray(v)) throw new FormatError(`manifest: "editions" must be an array`);
  return v.map((e, i) => {
    const o = (e ?? {}) as Record<string, unknown>;
    const name = `editions[${i}]`;
    return {
      language: str(o.language, `${name}.language`),
      title: str(o.title, `${name}.title`),
      author: str(o.author, `${name}.author`),
      identifier: str(o.identifier, `${name}.identifier`),
      isbn: o.isbn == null ? null : str(o.isbn, `${name}.isbn`),
      cover: o.cover == null ? null : cover(o.cover, `${name}.cover`),
    };
  });
}

const stringMap = (v: unknown, name: string): Record<string, string> => {
  if (typeof v !== "object" || v === null || Array.isArray(v))
    throw new FormatError(`manifest: "${name}" must be an object`);
  return Object.fromEntries(Object.entries(v).map(([k, s]) => [k, str(s, `${name}.${k}`)]));
};

function entries(v: unknown, name: string, section: "front" | "chapter" | "back"): EditionEntry[] {
  if (!Array.isArray(v)) throw new FormatError(`manifest: "${name}" must be an array`);
  return v.map((e, i) => {
    const o = (e ?? {}) as Record<string, unknown>;
    const id = str(o.id, `${name}[${i}].id`);
    if (!isValidEntryId(id))
      throw new FormatError(
        `manifest: "${name}[${i}].id" must start with a letter and use only letters, digits, "-" and "_" (got ${JSON.stringify(id)})`,
      );
    const entry: EditionEntry = {
      id,
      titles: stringMap(o.titles, `${name}[${i}].titles`),
      files: stringMap(o.files, `${name}[${i}].files`),
    };
    if (o.untranslated !== undefined) {
      if (
        !Array.isArray(o.untranslated) ||
        !o.untranslated.every((l) => typeof l === "string" && l)
      )
        throw new FormatError(`manifest: "${name}[${i}].untranslated" must be a list of languages`);
      entry.untranslated = o.untranslated as string[];
    }
    if (o.kind !== undefined) {
      const ok =
        section === "front"
          ? isFrontMatterKind(o.kind)
          : section === "back" && isBackMatterKind(o.kind);
      if (!ok)
        throw new FormatError(`manifest: invalid kind ${JSON.stringify(o.kind)} in ${name}[${i}]`);
      entry.kind = o.kind as MatterKind;
    }
    return entry;
  });
}

const FONT_KEYS = ["body", "heading"] as const;
// eslint-disable-next-line no-control-regex -- intentional: font names may not hold control characters
const CONTROL = /[\u0000-\u001F\u007F-\u009F]/;

function fontName(v: unknown, name: string): string {
  if (
    typeof v !== "string" ||
    v.trim() === "" ||
    v !== v.trim() ||
    v.length > 100 ||
    CONTROL.test(v)
  )
    throw new FormatError(
      `manifest: "${name}" must be a trimmed font family name of 1 to 100 characters without control characters`,
    );
  return v;
}

/** Validates `manifest.fonts`: an object with only `body` and `heading`, each a plain family name. Returns only the keys that are set. */
export function validateFonts(v: unknown): BookFonts {
  if (typeof v !== "object" || v === null || Array.isArray(v))
    throw new FormatError('manifest: "fonts" must be an object');
  const o = v as Record<string, unknown>;
  for (const k of Object.keys(o))
    if (!(FONT_KEYS as readonly string[]).includes(k))
      throw new FormatError(`manifest: unknown key "fonts.${k}"`);
  const out: BookFonts = {};
  for (const k of FONT_KEYS) if (o[k] !== undefined) out[k] = fontName(o[k], `fonts.${k}`);
  return out;
}

/** Validates an already-migrated manifest object. Throws FormatError on any problem. */
export function validateManifest(raw: unknown, version = CURRENT_FORMAT_VERSION): Manifest {
  const o = (raw ?? {}) as Record<string, unknown>;
  if (o.formatVersion !== version)
    throw new FormatError(`manifest: unsupported formatVersion ${String(o.formatVersion)}`);
  const m: Manifest = {
    formatVersion: version,
    editions: editions(o.editions),
    template: str(o.template, "template"),
    frontMatter: entries(o.frontMatter, "frontMatter", "front"),
    chapters: entries(o.chapters, "chapters", "chapter"),
    backMatter: entries(o.backMatter, "backMatter", "back"),
    references: validateReferences(o.references),
  };
  if (o.trimSize !== undefined) {
    if (!isTrimSize(o.trimSize))
      throw new FormatError(`manifest: unknown trimSize ${JSON.stringify(o.trimSize)}`);
    m.trimSize = o.trimSize;
  }
  if (o.fonts !== undefined) m.fonts = validateFonts(o.fonts);
  validateEditions(m.editions, readingOrder(m));
  const seen = new Set<string>();
  for (const e of readingOrder(m)) {
    if (seen.has(e.id)) throw new FormatError(`manifest: duplicate id "${e.id}"`);
    seen.add(e.id);
  }
  return m;
}

export const serializeManifest = (m: Manifest): string => JSON.stringify(m, null, 2) + "\n";
