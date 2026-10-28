import { RE2JS } from "re2js";

export interface TextRange {
  /** Offsets in UTF-16 code units, `to` exclusive. */
  from: number;
  to: number;
  /** Regex mode only: the match and its first nine capture groups ("" for a group that did not take part). */
  captures?: string[];
}

export interface MatchOptions {
  matchCase: boolean;
  wholeWord: boolean;
  /** The query is an RE2 regular expression (see `compileRegex`). Absent means literal. */
  regex?: boolean;
  /** Regex mode: stop after this many matches (default `MAX_MATCHES`, a UI guard). Replacing passes Infinity so no match is skipped. */
  limit?: number;
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
    const ch =
      low >= 0xdc00 && low <= 0xdfff && index >= 2
        ? text.slice(index - 2, index)
        : text.charAt(index - 1);
    return wordChar.test(ch);
  }
  if (index >= text.length) return false;
  const cp = text.codePointAt(index);
  return cp !== undefined && wordChar.test(String.fromCodePoint(cp));
};

/**
 * Finds literal occurrences (or regex matches with `regex`, see below) of `query` in `text`. Matches are non-overlapping, scanned left to right
 * ("aa" in "aaa" gives one match at 0). An empty query matches nothing. Whole word means the characters just outside
 * the match are not letters, digits or combining marks (Unicode `\p{L}\p{N}\p{M}`).
 */
export function findInText(
  text: string,
  query: string,
  { matchCase, wholeWord, regex, limit }: MatchOptions,
): TextRange[] {
  if (regex) return findRegexInText(text, query, matchCase, wholeWord, limit ?? MAX_MATCHES);
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

/**
 * Regex mode. The pattern is an RE2 regular expression run by `re2js` (UTF-16 offsets, case-insensitive unless Match
 * case is on). RE2 matches in time linear in the text, so a pattern cannot hang the UI thread; backreferences and
 * lookaround do not exist in RE2 and are reported as an invalid pattern, like any other syntax error. `^` and `$` mean
 * the start and end of a run, `.` does not cross a run.
 *
 * Whole word cannot use lookarounds, so each match is checked afterwards: it is rejected when a letter, digit or
 * combining mark (the same Unicode word set as the literal path) touches either side, and the scan resumes one
 * character after the rejected match's start so overlapping candidates are still tried. Unlike a lookaround wrapper,
 * this cannot make the engine pick a different alternative: "ab|abcd" on "abcd" finds "ab", rejects it, and never
 * finds "abcd" (put the longer alternative first: "abcd|ab").
 *
 * `MAX_MATCHES` is only a UI guard against pathological counts (decorating a million matches), not a safety net.
 */
export const MAX_MATCHES = 10000;

let cached: { key: string; re: RE2JS | null } | null = null;

/** The compiled search regex, or null when the pattern is empty or not valid RE2 syntax (never throws). */
export function compileRegex(query: string, matchCase: boolean): RE2JS | null {
  if (!query) return null;
  const key = `${matchCase ? 1 : 0}${query}`;
  if (cached?.key === key) return cached.re;
  let re: RE2JS | null = null;
  try {
    re = RE2JS.compile(query, matchCase ? 0 : RE2JS.CASE_INSENSITIVE);
  } catch {
    re = null;
  }
  cached = { key, re };
  return re;
}

/** Index just after the code point starting at `index`. */
const nextCodePoint = (text: string, index: number): number =>
  index + ((text.codePointAt(index) ?? 0) > 0xffff ? 2 : 1);

function findRegexInText(
  text: string,
  query: string,
  matchCase: boolean,
  wholeWord: boolean,
  limit: number,
): TextRange[] {
  const re = compileRegex(query, matchCase);
  if (!re || !text) return [];
  const m = re.matcher(text);
  const groups = Math.min(re.groupCount(), 9);
  const found: TextRange[] = [];
  let pos = 0;
  while (found.length < limit && pos <= text.length && m.find(pos)) {
    const from = m.start();
    const to = m.end();
    if (to === from || (wholeWord && (isWordAt(text, from, true) || isWordAt(text, to, false)))) {
      // Zero-length (skipped) or rejected by Whole word: retry one code point after this start so the scan always advances.
      pos = nextCodePoint(text, from);
      continue;
    }
    const captures = [text.slice(from, to)];
    for (let i = 1; i <= groups; i++) captures.push(m.group(i) ?? "");
    found.push({ from, to, captures });
    pos = to;
  }
  return found;
}

/** Whether a regex-mode query is unusable (invalid or refused). An empty query is not "invalid". */
export const isInvalidRegex = (query: string, matchCase: boolean): boolean =>
  query !== "" && compileRegex(query, matchCase) === null;

/**
 * The replacement text for one match. Regex mode expands `$1`..`$9` (the capture, "" if it did not take part; a
 * number above the pattern's group count stays as typed), `$&` (the whole match) and `$$` (a dollar sign), like
 * String.prototype.replace; other `$` sequences stay literal. Literal mode returns the replacement unchanged.
 */
export function expandReplacement(
  range: TextRange,
  replacement: string,
  regex: boolean | undefined,
): string {
  const caps = range.captures;
  if (!regex || !caps || !replacement.includes("$")) return replacement;
  return replacement.replace(/\$([$&1-9])/g, (all, c: string) => {
    if (c === "$") return "$";
    if (c === "&") return caps[0] ?? "";
    const n = Number(c);
    return n < caps.length ? (caps[n] ?? "") : all;
  });
}
