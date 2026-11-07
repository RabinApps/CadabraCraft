import {
  MAX_SCENE_CAST,
  MAX_SCENE_LABEL,
  MAX_SCENE_POV,
  MAX_SCENE_SYNOPSIS,
  MAX_SCENE_TARGET,
  MAX_SCENE_TITLE,
  SCENE_STATUSES,
} from "@cadabracraft/editor-schema";
import { isValidSceneId } from "@cadabracraft/shared";

/** A scene read from an outline file, cleaned to what a scene may hold. */
export interface ParsedScene {
  /** The scene id the file carried, or empty (the importer makes a new one). Unique within the file. */
  id: string;
  title: string;
  synopsis: string;
  pov: string;
  status: string;
  label: string;
  target: number | null;
  date: string;
  /** Codex ids (OPML carries them). */
  castIds: string[];
  /** Codex names (Markdown carries those). */
  castNames: string[];
}

export interface ParsedChapter {
  title: string;
  scenes: ParsedScene[];
}

export type OutlineWarningCode =
  | "clamped"
  | "bad-status"
  | "bad-target"
  | "bad-date"
  | "bad-id"
  | "duplicate-id"
  | "ignored"
  | "cast-skipped";

/** Something the file held that could not be kept as written. */
export interface OutlineWarning {
  code: OutlineWarningCode;
  message: string;
}

export interface ParsedOutline {
  chapters: ParsedChapter[];
  warnings: OutlineWarning[];
}

/** Why a file could not be read as an outline at all. */
export type OutlineErrorCode =
  "too-large" | "malformed" | "not-opml" | "not-csv" | "too-many" | "empty";

export class OutlineError extends Error {
  readonly code: OutlineErrorCode;
  constructor(code: OutlineErrorCode, message: string) {
    super(message);
    this.name = "OutlineError";
    this.code = code;
  }
}

/** The biggest outline file read (an outline of a long series is a few hundred kilobytes). */
export const MAX_OUTLINE_BYTES = 5_000_000;
export const MAX_OUTLINE_CHAPTERS = 1000;
export const MAX_OUTLINE_SCENES = 20_000;

const DATE = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?$/;

/** The raw strings one scene came in as; `undefined` for a field the file does not have. */
export interface RawScene {
  id?: string | undefined;
  title?: string | undefined;
  synopsis?: string | undefined;
  pov?: string | undefined;
  status?: string | undefined;
  label?: string | undefined;
  target?: string | undefined;
  date?: string | undefined;
  castIds?: string[] | undefined;
  castNames?: string[] | undefined;
}

type Warn = (code: OutlineWarningCode, message: string) => void;

function cleanId(raw: RawScene, where: string, seen: Set<string>, warn: Warn): string {
  let id = raw.id?.trim() ?? "";
  if (id && !isValidSceneId(id)) {
    warn("bad-id", `${where}: the id ${JSON.stringify(id)} is not allowed and was dropped`);
    id = "";
  }
  if (id && seen.has(id)) {
    warn("duplicate-id", `${where}: the id ${id} is used twice and was dropped here`);
    id = "";
  }
  if (id) seen.add(id);
  return id;
}

function cleanStatus(raw: RawScene, where: string, warn: Warn): string {
  const status = raw.status?.trim().toLowerCase() ?? "";
  if (status && !SCENE_STATUSES.includes(status as (typeof SCENE_STATUSES)[number])) {
    warn(
      "bad-status",
      `${where}: the status ${JSON.stringify(status)} is not one of ours and was dropped`,
    );
    return "";
  }
  return status;
}

function cleanTarget(raw: RawScene, where: string, warn: Warn): number | null {
  const t = raw.target?.trim() ?? "";
  if (!t) return null;
  const n = /^\d+$/.test(t) ? Number(t) : NaN;
  if (n <= MAX_SCENE_TARGET) return n;
  warn(
    "bad-target",
    `${where}: the target ${JSON.stringify(t)} is not a whole number of words and was dropped`,
  );
  return null;
}

function cleanDate(raw: RawScene, where: string, warn: Warn): string {
  const date = raw.date?.trim() ?? "";
  if (date && !DATE.test(date)) {
    warn(
      "bad-date",
      `${where}: the date ${JSON.stringify(date)} is not YYYY-MM-DD and was dropped`,
    );
    return "";
  }
  return date;
}

function cleanCast(list: string[] | undefined, where: string, warn: Warn): string[] {
  const kept = [...new Set((list ?? []).map((s) => s.trim()).filter(Boolean))];
  if (kept.length > MAX_SCENE_CAST)
    warn("clamped", `${where}: the cast is longer than ${MAX_SCENE_CAST} and was cut`);
  return kept.slice(0, MAX_SCENE_CAST);
}

/** Collects warnings and keeps scene ids unique across the file. */
export function createCleaner() {
  const warnings: OutlineWarning[] = [];
  const seen = new Set<string>();
  let scenes = 0;
  const warn: Warn = (code, message) => warnings.push({ code, message });
  const text = (value: string | undefined, max: number, field: string, where: string) => {
    const v = value ?? "";
    if (v.length <= max) return v;
    warn("clamped", `${where}: the ${field} is longer than ${max} characters and was cut`);
    return v.slice(0, max);
  };
  const scene = (raw: RawScene): ParsedScene => {
    if (++scenes > MAX_OUTLINE_SCENES)
      throw new OutlineError("too-many", `The file has more than ${MAX_OUTLINE_SCENES} scenes`);
    const title = text(raw.title?.trim(), MAX_SCENE_TITLE, "title", raw.title?.trim() || "a scene");
    const where = title || "a scene";
    return {
      id: cleanId(raw, where, seen, warn),
      title,
      synopsis: text(raw.synopsis?.trim(), MAX_SCENE_SYNOPSIS, "synopsis", where),
      pov: text(raw.pov?.trim(), MAX_SCENE_POV, "point of view", where),
      status: cleanStatus(raw, where, warn),
      label: text(raw.label?.trim(), MAX_SCENE_LABEL, "label", where),
      target: cleanTarget(raw, where, warn),
      date: cleanDate(raw, where, warn),
      castIds: cleanCast(raw.castIds, where, warn),
      castNames: cleanCast(raw.castNames, where, warn),
    };
  };
  return { warn, scene, warnings };
}

export type Cleaner = ReturnType<typeof createCleaner>;

/** Guard shared by both parsers. */
export function checkSize(input: string): void {
  if (input.length > MAX_OUTLINE_BYTES)
    throw new OutlineError(
      "too-large",
      `The file is larger than ${MAX_OUTLINE_BYTES / 1_000_000} MB`,
    );
}

/** A chapter title cut like the other short strings (page titles are not limited by the schema, so this is a sanity cap). */
export const chapterTitle = (s: string | undefined): string => (s ?? "").trim().slice(0, 500);

export function checkChapters(count: number): void {
  if (count > MAX_OUTLINE_CHAPTERS)
    throw new OutlineError("too-many", `The file has more than ${MAX_OUTLINE_CHAPTERS} chapters`);
}
