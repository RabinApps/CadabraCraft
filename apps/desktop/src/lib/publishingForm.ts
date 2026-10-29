import { PUBLISHING_LIMITS } from "@cadabracraft/format";
import type { Publishing } from "@cadabracraft/shared";

/** The retail fields of the Book details dialog as text. Subjects are one per line. */
export interface PublishingForm {
  publisher: string;
  description: string;
  subjects: string;
  series: string;
  seriesNumber: string;
  rights: string;
  published: string;
}

export const publishingToForm = (p: Publishing | undefined): PublishingForm => ({
  publisher: p?.publisher ?? "",
  description: p?.description ?? "",
  subjects: (p?.subjects ?? []).join("\n"),
  series: p?.series ?? "",
  seriesNumber: p?.seriesNumber ?? "",
  rights: p?.rights ?? "",
  published: p?.published ?? "",
});

/** The subject lines of the form: trimmed, empty lines dropped, repeats dropped. */
export const subjectLines = (text: string): string[] => [
  ...new Set(
    text
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean),
  ),
];

/** The form as stored: trimmed text, and only the keys that have a value. A series number without a series is left out. */
export function publishingFromForm(f: PublishingForm): Publishing {
  const text = (s: string) => s.trim();
  const out: Publishing = {};
  if (text(f.publisher)) out.publisher = text(f.publisher);
  if (text(f.description)) out.description = text(f.description).replace(/\r\n?/g, "\n");
  const subjects = subjectLines(f.subjects);
  if (subjects.length) out.subjects = subjects;
  if (text(f.series)) {
    out.series = text(f.series);
    if (text(f.seriesNumber)) out.seriesNumber = text(f.seriesNumber);
  }
  if (text(f.rights)) out.rights = text(f.rights);
  if (text(f.published)) out.published = text(f.published);
  return out;
}

export type PublishingProblem =
  | { field: "publisher" | "series" | "rights" | "description"; code: "too-long"; max: number }
  | { field: "subjects"; code: "too-many"; max: number }
  | { field: "subjects"; code: "too-long"; max: number }
  | { field: "seriesNumber"; code: "bad-number" | "needs-series" }
  | { field: "publisher" | "series" | "rights"; code: "multi-line" }
  | { field: "published"; code: "bad-date" };

const NUMBER = /^\d{1,6}(\.\d{1,3})?$/;

/** The first thing in the form the manifest would refuse, or null. The dialog words each code in the author's language. */
export function publishingProblem(f: PublishingForm): PublishingProblem | null {
  for (const field of ["publisher", "series", "rights"] as const) {
    const v = f[field].trim();
    if (/[\r\n]/.test(v)) return { field, code: "multi-line" };
    if (v.length > PUBLISHING_LIMITS[field])
      return { field, code: "too-long", max: PUBLISHING_LIMITS[field] };
  }
  if (f.description.trim().length > PUBLISHING_LIMITS.description)
    return { field: "description", code: "too-long", max: PUBLISHING_LIMITS.description };
  const subjects = subjectLines(f.subjects);
  if (subjects.length > PUBLISHING_LIMITS.subjects)
    return { field: "subjects", code: "too-many", max: PUBLISHING_LIMITS.subjects };
  if (subjects.some((s) => s.length > PUBLISHING_LIMITS.subject))
    return { field: "subjects", code: "too-long", max: PUBLISHING_LIMITS.subject };
  const number = f.seriesNumber.trim();
  if (number && !f.series.trim()) return { field: "seriesNumber", code: "needs-series" };
  if (number && !NUMBER.test(number)) return { field: "seriesNumber", code: "bad-number" };
  const date = f.published.trim();
  if (date) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
    const at = m && new Date(Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!));
    const ok =
      at &&
      at.getUTCFullYear() === +m![1]! &&
      at.getUTCMonth() === +m![2]! - 1 &&
      at.getUTCDate() === +m![3]!;
    if (!ok) return { field: "published", code: "bad-date" };
  }
  return null;
}
