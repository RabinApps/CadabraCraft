import type { Publishing } from "@cadabracraft/shared";
import { FormatError } from "./errors";

export type { Publishing };

export const PUBLISHING_LIMITS = {
  publisher: 200,
  description: 4000,
  subject: 100,
  subjects: 20,
  series: 200,
  rights: 500,
} as const;

const KEYS = [
  "publisher",
  "description",
  "subjects",
  "series",
  "seriesNumber",
  "rights",
  "published",
] as const;

// eslint-disable-next-line no-control-regex -- intentional: single-line values may not hold control characters
const CONTROL = /[\u0000-\u001F\u007F-\u009F]/;
// Line breaks are the only control characters a description may hold.
// eslint-disable-next-line no-control-regex
const CONTROL_NO_BREAK = /[\u0000-\u0009\u000B\u000C\u000E-\u001F\u007F-\u009F]/;
const SERIES_NUMBER = /^\d{1,6}(\.\d{1,3})?$/;
const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

function line(v: unknown, name: string, max: number): string {
  if (
    typeof v !== "string" ||
    v.trim() === "" ||
    v !== v.trim() ||
    v.length > max ||
    CONTROL.test(v)
  )
    throw new FormatError(
      `manifest: "${name}" must be a trimmed single line of 1 to ${max} characters`,
    );
  return v;
}

function isCalendarDate(v: string): boolean {
  const m = DATE.exec(v);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const at = new Date(Date.UTC(y, mo - 1, d));
  return at.getUTCFullYear() === y && at.getUTCMonth() === mo - 1 && at.getUTCDate() === d;
}

/** Validates an edition's `publishing`. Returns only the keys that are set; throws FormatError on anything else. */
export function validatePublishing(v: unknown, name = "publishing"): Publishing {
  if (typeof v !== "object" || v === null || Array.isArray(v))
    throw new FormatError(`manifest: "${name}" must be an object`);
  const o = v as Record<string, unknown>;
  for (const k of Object.keys(o))
    if (!(KEYS as readonly string[]).includes(k))
      throw new FormatError(`manifest: unknown key "${name}.${k}"`);
  const out: Publishing = {};
  if (o.publisher !== undefined)
    out.publisher = line(o.publisher, `${name}.publisher`, PUBLISHING_LIMITS.publisher);
  if (o.description !== undefined) {
    const d = o.description;
    if (
      typeof d !== "string" ||
      d.trim() === "" ||
      d !== d.trim() ||
      d.length > PUBLISHING_LIMITS.description ||
      CONTROL_NO_BREAK.test(d)
    )
      throw new FormatError(
        `manifest: "${name}.description" must be trimmed text of 1 to ${PUBLISHING_LIMITS.description} characters`,
      );
    out.description = d;
  }
  if (o.subjects !== undefined) {
    if (!Array.isArray(o.subjects) || o.subjects.length === 0)
      throw new FormatError(`manifest: "${name}.subjects" must be a non-empty list`);
    if (o.subjects.length > PUBLISHING_LIMITS.subjects)
      throw new FormatError(
        `manifest: "${name}.subjects" has more than ${PUBLISHING_LIMITS.subjects} entries`,
      );
    const subjects = o.subjects.map((s, i) =>
      line(s, `${name}.subjects[${i}]`, PUBLISHING_LIMITS.subject),
    );
    if (new Set(subjects).size !== subjects.length)
      throw new FormatError(`manifest: "${name}.subjects" repeats an entry`);
    out.subjects = subjects;
  }
  if (o.series !== undefined)
    out.series = line(o.series, `${name}.series`, PUBLISHING_LIMITS.series);
  if (o.seriesNumber !== undefined) {
    if (out.series === undefined)
      throw new FormatError(`manifest: "${name}.seriesNumber" needs a "${name}.series"`);
    if (typeof o.seriesNumber !== "string" || !SERIES_NUMBER.test(o.seriesNumber))
      throw new FormatError(
        `manifest: "${name}.seriesNumber" must be digits with an optional decimal part`,
      );
    out.seriesNumber = o.seriesNumber;
  }
  if (o.rights !== undefined)
    out.rights = line(o.rights, `${name}.rights`, PUBLISHING_LIMITS.rights);
  if (o.published !== undefined) {
    if (typeof o.published !== "string" || !isCalendarDate(o.published))
      throw new FormatError(`manifest: "${name}.published" must be a date as YYYY-MM-DD`);
    out.published = o.published;
  }
  return out;
}

/** True when nothing is set, so callers can leave `publishing` out of the file. */
export const isPublishingEmpty = (p: Publishing | undefined): boolean =>
  p === undefined || Object.keys(p).length === 0;

/** Migration step: formatVersion 5 -> 6. Nothing to change: `publishing` is optional and absent means none. */
export const migrateV5ToV6 = (raw: Record<string, unknown>): Record<string, unknown> => ({
  ...raw,
});
