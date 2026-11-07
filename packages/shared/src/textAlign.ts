/**
 * Text alignment of a paragraph or heading (`attrs.textAlign`). Logical, like CSS `start` / `end`: `start` is the side a line
 * begins on (left in a left-to-right book, right in a right-to-left one). Absent (or null) means "what the template does".
 */
export type TextAlign = "start" | "center" | "end";

export const TEXT_ALIGNS: readonly TextAlign[] = ["start", "center", "end"];

/** The alignment in `value`: null when absent, undefined when it is something else than a `TextAlign` (a file written by hand or by a newer app). */
export function parseTextAlign(value: unknown): TextAlign | null | undefined {
  if (value === undefined || value === null) return null;
  return TEXT_ALIGNS.includes(value as TextAlign) ? (value as TextAlign) : undefined;
}

/** Why `value` is not a valid `textAlign` (null when it is valid or absent); the schema check and the exporters share the wording. */
export const textAlignProblem = (value: unknown): string | null =>
  parseTextAlign(value) === undefined
    ? `text alignment ${JSON.stringify(value)} is not allowed (start, center or end)`
    : null;
