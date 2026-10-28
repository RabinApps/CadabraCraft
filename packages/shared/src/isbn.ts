/**
 * Normalises ISBN text ("978-3-16-148410-0", "ISBN 0-306-40615-2", "080442957X") to the 13-digit ISBN-13 with no
 * hyphens or spaces. An ISBN-10 is converted (978 prefix, new check digit). Returns null for empty text, wrong
 * length, stray characters or a wrong check digit, so callers can skip it instead of publishing a bad identifier.
 */
export function normalizeIsbn(text: string | null | undefined): string | null {
  if (!text) return null;
  const s = text
    .trim()
    .replace(/^isbn(?:-1[03])?:?\s*/i, "")
    .replace(/[\s-]/g, "")
    .toUpperCase();
  if (/^\d{13}$/.test(s)) {
    if (!/^97[89]/.test(s)) return null;
    return isbn13Check(s.slice(0, 12)) === s[12] ? s : null;
  }
  if (/^\d{9}[\dX]$/.test(s)) {
    const sum = [...s].reduce((acc, ch, i) => acc + (ch === "X" ? 10 : Number(ch)) * (10 - i), 0);
    if (sum % 11 !== 0) return null;
    const body = `978${s.slice(0, 9)}`;
    return body + isbn13Check(body);
  }
  return null;
}

function isbn13Check(twelve: string): string {
  const sum = [...twelve].reduce((acc, ch, i) => acc + Number(ch) * (i % 2 === 0 ? 1 : 3), 0);
  return String((10 - (sum % 10)) % 10);
}
