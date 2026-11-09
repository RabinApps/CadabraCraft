import { t } from "@lingui/core/macro";
import { normalizeIsbn } from "@cadabracraft/shared";

/** The message for an ISBN that is neither empty nor a valid ISBN-10 or ISBN-13 (shape or check digit). */
export const isbnProblemText = () =>
  t`Enter a valid ISBN: 10 or 13 digits with a correct check digit, or leave the field empty.`;

/** True when the ISBN text is empty (no ISBN) or a valid ISBN-10 or ISBN-13. */
export const isbnValid = (text: string): boolean => !text.trim() || normalizeIsbn(text) !== null;

/** The ISBN as stored: its 13 digits with no hyphens or spaces, or null when empty. An invalid value throws; the dialog refuses to save one first. */
export function isbnToStored(text: string): string | null {
  if (!text.trim()) return null;
  const digits = normalizeIsbn(text);
  if (digits === null) throw new Error(isbnProblemText());
  return digits;
}
