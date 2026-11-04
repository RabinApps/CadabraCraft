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
import { validatePublishing, type Publishing } from "./publishing";

export { FormatError, isSafeRelativePath } from "./errors";

export const CURRENT_FORMAT_VERSION = 9;

/** One language version of the book (formatVersion 4). The first edition is the source. */
export interface Edition {
  language: string;
  title: string;
  author: string;
  identifier: string;
  isbn: string | null;
  /** Relative `assets/<name>` path of this edition's cover image, or null. */
  cover: string | null;
  /** Retail details for the EPUB's OPF metadata (formatVersion 6). Absent means none are set. */
  publishing?: Publishing;
}

/** Depth of headings a contents page lists below each page: 0 lists pages only, 1 to 3 add headings up to that level. */
export type TocDepth = 0 | 1 | 2 | 3;

/** A contents entry the author added by hand (formatVersion 7). Its item key is `custom:<id>`. */
export interface TocCustom {
  id: string;
  /** Language to the entry's text. Has at least one language. */
  titles: Record<string, string>;
  /** Item key it follows in the list (a page id, a heading key or another `custom:<id>`). */
  after: string;
  /** Item key the entry points at (and takes its page number from). Absent means it points nowhere. */
  target?: string;
}

/**
 * How a contents page differs from the generated list (formatVersion 7). The list itself is never stored: it is built from the
 * outline, and these are overrides layered on top. Item keys are described in `toc.ts`.
 */
export interface TocSettings {
  depth: TocDepth;
  pageNumbers: boolean;
  /** Item keys left out of the list. */
  hidden: string[];
  /** Item key to language to replacement text. */
  titles: Record<string, Record<string, string>>;
  /** Item keys in the order the author arranged them. Absent means reading order. */
  order?: string[];
  custom: TocCustom[];
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
  /** Sidebar icon, a name from `ENTRY_ICONS`. Shown in the app only, never exported. Absent means none. Added without a version bump: older apps ignore it. */
  icon?: string;
  /** Chapters only (formatVersion 8): a big first letter on this chapter's opening paragraph (true) or none (false). Absent follows the book's `dropCap`. */
  dropCap?: boolean;
  /** Front and back matter pages only, except contents and copyright (formatVersion 9): centre the page's content between the margins (true) or keep it at the top (false). Absent follows the template's default for the kind. */
  verticalCenter?: boolean;
  /** Contents pages only (`kind: "contents"`, formatVersion 7): the author's changes to the generated list. Absent means defaults. */
  toc?: TocSettings;
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
  /** Big first letter on chapter openings (formatVersion 8). Absent means the template decides; a chapter's own `dropCap` wins. */
  dropCap?: boolean;
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

const ICON_NAME = /^[a-z][a-z0-9-]{0,39}$/;
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
    const publishing =
      o.publishing === undefined
        ? undefined
        : validatePublishing(o.publishing, `${name}.publishing`);
    return {
      language: str(o.language, `${name}.language`),
      title: str(o.title, `${name}.title`),
      author: str(o.author, `${name}.author`),
      identifier: str(o.identifier, `${name}.identifier`),
      isbn: o.isbn == null ? null : str(o.isbn, `${name}.isbn`),
      cover: o.cover == null ? null : cover(o.cover, `${name}.cover`),
      ...(publishing && Object.keys(publishing).length > 0 ? { publishing } : {}),
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
    if (o.icon !== undefined) {
      // Names this app does not know are kept (a newer app wrote them) and shown as no icon.
      if (typeof o.icon !== "string" || !ICON_NAME.test(o.icon))
        throw new FormatError(`manifest: "${name}[${i}].icon" must be an icon name`);
      entry.icon = o.icon;
    }
    if (o.dropCap !== undefined) {
      if (section !== "chapter")
        throw new FormatError(`manifest: "${name}[${i}].dropCap" belongs on a chapter only`);
      if (typeof o.dropCap !== "boolean")
        throw new FormatError(`manifest: "${name}[${i}].dropCap" must be true or false`);
      entry.dropCap = o.dropCap;
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
    if (o.verticalCenter !== undefined) {
      if (section === "chapter" || entry.kind === "contents" || entry.kind === "copyright")
        throw new FormatError(
          `manifest: "${name}[${i}].verticalCenter" belongs on a front or back matter page other than contents and copyright`,
        );
      if (typeof o.verticalCenter !== "boolean")
        throw new FormatError(`manifest: "${name}[${i}].verticalCenter" must be true or false`);
      entry.verticalCenter = o.verticalCenter;
    }
    if (o.toc !== undefined) {
      if (entry.kind !== "contents")
        throw new FormatError(`manifest: "${name}[${i}].toc" belongs on a contents page only`);
      entry.toc = validateToc(o.toc, `${name}[${i}].toc`);
    }
    return entry;
  });
}

const TOC_KEYS = ["depth", "pageNumbers", "hidden", "titles", "order", "custom"] as const;
const TOC_CUSTOM_KEYS = ["id", "titles", "after", "target"] as const;

const keyList = (v: unknown, name: string): string[] => {
  if (!Array.isArray(v) || !v.every((k) => typeof k === "string" && k !== ""))
    throw new FormatError(`manifest: "${name}" must be a list of item keys`);
  if (new Set(v).size !== v.length) throw new FormatError(`manifest: "${name}" repeats a key`);
  return v as string[];
};

function noUnknownKeys(o: Record<string, unknown>, keys: readonly string[], name: string): void {
  for (const k of Object.keys(o))
    if (!keys.includes(k)) throw new FormatError(`manifest: unknown key "${name}.${k}"`);
}

const plainObject = (v: unknown, name: string): Record<string, unknown> => {
  if (typeof v !== "object" || v === null || Array.isArray(v))
    throw new FormatError(`manifest: "${name}" must be an object`);
  return v as Record<string, unknown>;
};

/** Validates a contents page's `toc` (formatVersion 7). Throws FormatError; unknown keys are refused so a typo is not silently lost. */
export function validateToc(v: unknown, name = "toc"): TocSettings {
  const o = plainObject(v, name);
  noUnknownKeys(o, TOC_KEYS, name);
  if (o.depth !== 0 && o.depth !== 1 && o.depth !== 2 && o.depth !== 3)
    throw new FormatError(`manifest: "${name}.depth" must be 0, 1, 2 or 3`);
  if (typeof o.pageNumbers !== "boolean")
    throw new FormatError(`manifest: "${name}.pageNumbers" must be true or false`);
  const titlesIn = plainObject(o.titles, `${name}.titles`);
  const titles = Object.fromEntries(
    Object.entries(titlesIn).map(([key, byLang]) => [
      key,
      stringMap(byLang, `${name}.titles.${key}`),
    ]),
  );
  if (!Array.isArray(o.custom))
    throw new FormatError(`manifest: "${name}.custom" must be an array`);
  const ids = new Set<string>();
  const custom = o.custom.map((c, i): TocCustom => {
    const cname = `${name}.custom[${i}]`;
    const co = plainObject(c, cname);
    noUnknownKeys(co, TOC_CUSTOM_KEYS, cname);
    const id = str(co.id, `${cname}.id`);
    if (!isValidEntryId(id))
      throw new FormatError(
        `manifest: "${cname}.id" must start with a letter and use only letters, digits, "-" and "_" (got ${JSON.stringify(id)})`,
      );
    if (ids.has(id)) throw new FormatError(`manifest: duplicate custom contents id "${id}"`);
    ids.add(id);
    const ctitles = stringMap(co.titles, `${cname}.titles`);
    if (Object.keys(ctitles).length === 0)
      throw new FormatError(`manifest: "${cname}.titles" needs at least one language`);
    return {
      id,
      titles: ctitles,
      after: str(co.after, `${cname}.after`),
      ...(co.target === undefined ? {} : { target: str(co.target, `${cname}.target`) }),
    };
  });
  return {
    depth: o.depth,
    pageNumbers: o.pageNumbers,
    hidden: keyList(o.hidden, `${name}.hidden`),
    titles,
    ...(o.order === undefined ? {} : { order: keyList(o.order, `${name}.order`) }),
    custom,
  };
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
  if (o.dropCap !== undefined) {
    if (typeof o.dropCap !== "boolean")
      throw new FormatError(`manifest: "dropCap" must be true or false`);
    m.dropCap = o.dropCap;
  }
  validateEditions(m.editions, readingOrder(m));
  const seen = new Set<string>();
  for (const e of readingOrder(m)) {
    if (seen.has(e.id)) throw new FormatError(`manifest: duplicate id "${e.id}"`);
    seen.add(e.id);
  }
  return m;
}

export const serializeManifest = (m: Manifest): string => JSON.stringify(m, null, 2) + "\n";
