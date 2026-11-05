import { Node as PMNode } from "@tiptap/pm/model";
import {
  errMsg,
  isLangTag,
  isValidCommentId,
  isValidEntryId,
  isValidSceneId,
  safeHref,
  textAlignProblem,
  type ChapterDoc,
} from "@cadabracraft/shared";
import {
  MAX_SCENE_CAST,
  MAX_SCENE_DATE,
  MAX_SCENE_LABEL,
  MAX_SCENE_POV,
  MAX_SCENE_SYNOPSIS,
  MAX_SCENE_TARGET,
  MAX_SCENE_TITLE,
  SCENE_STATUSES,
} from "./nodes/blocks";
import { editorSchema } from "./extensions";

interface RawNode {
  type?: string;
  attrs?: Record<string, unknown>;
  content?: RawNode[];
  marks?: { type?: string; attrs?: Record<string, unknown> }[];
}

/** Why `doc` is not a valid chapter in the real editor schema (the one the app and exporters use), or null if it is valid. */
export function chapterDocProblem(doc: unknown): string | null {
  if (!doc || typeof doc !== "object" || (doc as { type?: unknown }).type !== "doc")
    return 'a chapter document must be an object with type "doc"';
  try {
    PMNode.fromJSON(editorSchema(), doc).check();
  } catch (e) {
    return errMsg(e);
  }
  // The schema's heading `levels` option only limits the editor's commands; the node spec itself accepts any level.
  let bad: unknown = null;
  let tableBad: string | null = null;
  let badHref: string | null = null;
  let badChecked = false;
  let badDecorative = false;
  let badLang: unknown = null;
  let badComment: unknown = null;
  let badScene: string | null = null;
  let badAlign: string | null = null;
  const walk = (n: RawNode) => {
    if (n.type === "heading" && ![1, 2, 3].includes(Number(n.attrs?.level))) bad ??= n.attrs?.level;
    for (const m of n.marks ?? [])
      if (m.type === "link" && safeHref(String(m.attrs?.href ?? "")) === null)
        badHref ??= String(m.attrs?.href ?? "");
    for (const m of n.marks ?? [])
      if (m.type === "lang" && !isLangTag(m.attrs?.lang)) badLang ??= m.attrs?.lang ?? "";
    for (const m of n.marks ?? [])
      if (m.type === "comment" && !isValidCommentId(m.attrs?.id)) badComment ??= m.attrs?.id ?? "";
    if (
      n.type === "taskItem" &&
      n.attrs?.checked !== undefined &&
      typeof n.attrs.checked !== "boolean"
    )
      badChecked = true;
    if (
      n.type === "image" &&
      n.attrs?.decorative !== undefined &&
      typeof n.attrs.decorative !== "boolean"
    )
      badDecorative = true;
    if (n.type === "paragraph" || n.type === "heading")
      badAlign ??= textAlignProblem(n.attrs?.textAlign);
    if (n.type === "scene") badScene ??= sceneProblem(n);
    if (n.type === "table") tableBad ??= tableProblem(n);
    for (const c of n.content ?? []) walk(c);
  };
  walk(doc as RawNode);
  if (bad !== null) return `heading level ${String(bad)} is not allowed (levels 1-3 only)`;
  if (badHref !== null)
    return `link ${JSON.stringify(badHref)} is not allowed (only http, https and mailto links)`;
  if (badLang !== null)
    return `language ${JSON.stringify(badLang)} is not allowed (a BCP 47 tag of letters, digits and hyphens, at most 35 characters)`;
  if (badComment !== null)
    return `comment ${JSON.stringify(badComment)} is not allowed (a thread id of a letter, then letters, digits, _ or -, at most 64 characters)`;
  if (badScene !== null) return badScene;
  if (badAlign !== null) return badAlign;
  if (badChecked) return "a task item's checked value must be true or false";
  if (badDecorative) return "an image's decorative value must be true or false";
  return tableBad;
}

/** True for a real calendar day `YYYY-MM-DD`, optionally with a 24-hour time `THH:MM`. Fantasy calendars are not modelled. */
export function isStoryDate(value: unknown): value is string {
  if (typeof value !== "string" || value.length > MAX_SCENE_DATE) return false;
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?$/.exec(value);
  if (!m) return false;
  const [year, month, day] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const probe = new Date(Date.UTC(2000, month - 1, day));
  probe.setUTCFullYear(year);
  const real =
    probe.getUTCFullYear() === year &&
    probe.getUTCMonth() === month - 1 &&
    probe.getUTCDate() === day;
  return real && (m[4] === undefined || (Number(m[4]) < 24 && Number(m[5]) < 60));
}

/** A scene's id names it, and its notes are short strings so a chapter file stays readable. */
function sceneProblem(scene: RawNode): string | null {
  const a = scene.attrs ?? {};
  if (!isValidSceneId(a.id))
    return `scene id ${JSON.stringify(a.id ?? "")} is not allowed (a letter, then letters, digits, _ or -, at most 64 characters)`;
  const limits: [string, number][] = [
    ["title", MAX_SCENE_TITLE],
    ["synopsis", MAX_SCENE_SYNOPSIS],
    ["pov", MAX_SCENE_POV],
    ["label", MAX_SCENE_LABEL],
  ];
  // A note that is not there is the schema's default (""), so only a note that is present is checked.
  for (const [key, max] of limits) {
    const v = a[key];
    if (v !== undefined && (typeof v !== "string" || v.length > max))
      return `a scene's ${key} must be text of at most ${max} characters`;
  }
  if (
    a.status !== undefined &&
    a.status !== "" &&
    !SCENE_STATUSES.includes(a.status as (typeof SCENE_STATUSES)[number])
  )
    return `scene status ${JSON.stringify(a.status)} is not allowed (outline, draft, revised, final, or empty)`;
  if (
    a.target !== undefined &&
    a.target !== null &&
    (typeof a.target !== "number" ||
      !Number.isInteger(a.target) ||
      a.target < 0 ||
      a.target > MAX_SCENE_TARGET)
  )
    return `a scene's target must be a whole number of words from 0 to ${MAX_SCENE_TARGET}, or null`;
  if (a.date !== undefined && a.date !== "" && !isStoryDate(a.date))
    return `a scene's date must be YYYY-MM-DD with an optional THH:MM, or empty (got ${JSON.stringify(a.date)})`;
  if (a.cast !== undefined) {
    if (!Array.isArray(a.cast)) return "a scene's cast must be a list of codex entry ids";
    if (a.cast.length > MAX_SCENE_CAST)
      return `a scene's cast holds ${a.cast.length} ids; the most is ${MAX_SCENE_CAST}`;
    const seen = new Set<string>();
    for (const id of a.cast) {
      if (!isValidEntryId(String(id)))
        return `scene cast ${JSON.stringify(id)} is not allowed (a letter, then letters, digits, _ or -, at most 64 characters)`;
      if (seen.has(String(id))) return `scene cast repeats ${JSON.stringify(id)}`;
      seen.add(String(id));
    }
  }
  return null;
}

/** Tables must be rectangular and unmerged: every row has the same number of cells, each with colspan and rowspan 1. */
function tableProblem(table: RawNode): string | null {
  /* v8 ignore next -- only called after PMNode.check(), which requires table rows */
  const rows = table.content ?? [];
  let width = -1;
  for (const [i, row] of rows.entries()) {
    const cells = row.content ?? [];
    for (const c of cells) {
      if (Number(c.attrs?.colspan ?? 1) !== 1 || Number(c.attrs?.rowspan ?? 1) !== 1)
        return "merged table cells (colspan/rowspan) are not supported";
    }
    if (cells.length === 0) return `table row ${i + 1} has no cells`;
    if (width < 0) width = cells.length;
    else if (cells.length !== width)
      return `table row ${i + 1} has ${cells.length} cells but the first row has ${width} (tables must be rectangular)`;
  }
  return null;
}

/** Runtime check that `doc` is a valid chapter document (see `chapterDocProblem`). */
export const isChapterDoc = (doc: unknown): doc is ChapterDoc => chapterDocProblem(doc) === null;

/** Throws with the schema problem unless `doc` is a valid chapter document. */
export function assertChapterDoc(doc: unknown): asserts doc is ChapterDoc {
  const problem = chapterDocProblem(doc);
  if (problem) throw new Error(`invalid chapter document: ${problem}`);
}
