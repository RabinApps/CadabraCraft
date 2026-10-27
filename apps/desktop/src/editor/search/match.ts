export interface TextRange {
  /** Offsets in UTF-16 code units, `to` exclusive. */
  from: number;
  to: number;
}

export interface MatchOptions {
  matchCase: boolean;
  wholeWord: boolean;
}

const wordChar = /[\p{L}\p{N}\p{M}]/u;
const ascii = /^[\x00-\x7f]*$/;

/**
 * Simple, locale-independent case folding that never changes the string length, so offsets in the folded text are
 * offsets in the original. Works per code point (no final-sigma or Turkish-dotted-I context): a code point whose
 * lowercase is a different length stays as it is. Accents and curly quotes are untouched (no normalization).
 */
export function fold(text: string): string {
  if (ascii.test(text)) return text.toLowerCase();
  let out = "";
  for (const ch of text) {
    const lower = ch.toLowerCase();
    out += lower.length === ch.length ? lower : ch;
  }
  return out;
}

const isWordAt = (text: string, index: number, before: boolean): boolean => {
  if (before) {
    if (index <= 0) return false;
    const low = text.charCodeAt(index - 1);
    const ch = low >= 0xdc00 && low <= 0xdfff && index >= 2 ? text.slice(index - 2, index) : text.charAt(index - 1);
    return wordChar.test(ch);
  }
  if (index >= text.length) return false;
  const cp = text.codePointAt(index);
  return cp !== undefined && wordChar.test(String.fromCodePoint(cp));
};

/**
 * Finds literal (never regex) occurrences of `query` in `text`. Matches are non-overlapping, scanned left to right
 * ("aa" in "aaa" gives one match at 0). An empty query matches nothing. Whole word means the characters just outside
 * the match are not letters, digits or combining marks (Unicode `\p{L}\p{N}\p{M}`).
 */
export function findInText(text: string, query: string, { matchCase, wholeWord }: MatchOptions): TextRange[] {
  if (!query || query.length > text.length) return [];
  const haystack = matchCase ? text : fold(text);
  const needle = matchCase ? query : fold(query);
  const found: TextRange[] = [];
  let at = haystack.indexOf(needle);
  while (at !== -1) {
    const end = at + needle.length;
    if (!wholeWord || (!isWordAt(text, at, true) && !isWordAt(text, end, false))) {
      found.push({ from: at, to: end });
      at = haystack.indexOf(needle, end);
    } else {
      at = haystack.indexOf(needle, at + 1);
    }
  }
  return found;
}
