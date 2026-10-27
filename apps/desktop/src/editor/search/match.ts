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
  /** The query is a JavaScript regular expression (see `compileRegex`). Absent means literal. */
  regex?: boolean;
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
 * Finds literal occurrences (or regex matches with `regex`, see below) of `query` in `text`. Matches are non-overlapping, scanned left to right
 * ("aa" in "aaa" gives one match at 0). An empty query matches nothing. Whole word means the characters just outside
 * the match are not letters, digits or combining marks (Unicode `\p{L}\p{N}\p{M}`).
 */
export function findInText(text: string, query: string, { matchCase, wholeWord, regex }: MatchOptions): TextRange[] {
  if (regex) return findRegexInText(text, query, matchCase, wholeWord);
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
 * Regex mode. The pattern is a JavaScript regular expression compiled with the `u` flag (plus `i` unless Match case is
 * on). Whole word wraps it as `(?<![\p{L}\p{N}\p{M}])(?:pattern)(?![\p{L}\p{N}\p{M}])`, the same Unicode word-character
 * test as the literal path. `^` and `$` mean the start and end of a run (no `m` flag), `.` does not cross a run.
 *
 * Catastrophic backtracking cannot be interrupted on the UI thread, so it is bounded by construction, not by time:
 *  - patterns with a quantified group that itself holds a quantifier ("(a+)+", "(.*)*", "(\w+\s?)*") are rejected up
 *    front and treated like an invalid pattern (a cheap heuristic: it also refuses a few harmless ones, and misses
 *    ambiguous alternations such as "(a|aa)+");
 *  - at most `MAX_MATCHES` matches are collected per scan (document-wide scans stop at the same cap).
 * Running regexes in a worker was rejected, see docs/architecture.md ("Regex find and replace").
 */
export const MAX_MATCHES = 10000;

const NESTED_QUANTIFIER = /\((?:[^()\\]|\\.)*(?:[+*]|\{\d+,\d*\})(?:[^()\\]|\\.)*\)(?:[+*]|\{\d+,\d*\})/;
const WORD = "[\\p{L}\\p{N}\\p{M}]";

let cached: { key: string; re: RegExp | null } | null = null;

/** The compiled search regex (global, so callers reset `lastIndex`), or null when the pattern is empty, invalid or too risky. */
export function compileRegex(query: string, matchCase: boolean, wholeWord: boolean): RegExp | null {
  if (!query) return null;
  const key = `${matchCase ? 1 : 0}${wholeWord ? 1 : 0}${query}`;
  if (cached?.key === key) return cached.re;
  let re: RegExp | null = null;
  if (!NESTED_QUANTIFIER.test(query)) {
    try {
      const flags = matchCase ? "gu" : "giu";
      new RegExp(query, flags); // validate on its own so wrapping cannot make a broken pattern valid, e.g. "a)(b"
      re = new RegExp(wholeWord ? `(?<!${WORD})(?:${query})(?!${WORD})` : query, flags);
    } catch {
      re = null;
    }
  }
  cached = { key, re };
  return re;
}

function findRegexInText(text: string, query: string, matchCase: boolean, wholeWord: boolean): TextRange[] {
  const re = compileRegex(query, matchCase, wholeWord);
  if (!re || !text) return [];
  const found: TextRange[] = [];
  re.lastIndex = 0;
  let m: RegExpExecArray | null;
  while (found.length < MAX_MATCHES && (m = re.exec(text))) {
    if (m[0] === "") {
      // Zero-length matches are skipped; step one code point so the scan always advances.
      const cp = text.codePointAt(re.lastIndex);
      re.lastIndex += cp !== undefined && cp > 0xffff ? 2 : 1;
      if (re.lastIndex > text.length) break;
      continue;
    }
    found.push({ from: m.index, to: m.index + m[0].length, captures: Array.from(m).slice(0, 10).map((c) => c ?? "") });
  }
  re.lastIndex = 0;
  return found;
}

/** Whether a regex-mode query is unusable (invalid or refused). An empty query is not "invalid". */
export const isInvalidRegex = (query: string, matchCase: boolean, wholeWord: boolean): boolean => query !== "" && compileRegex(query, matchCase, wholeWord) === null;

/**
 * The replacement text for one match. Regex mode expands `$1`..`$9` (the capture, "" if it did not take part; a
 * number above the pattern's group count stays as typed), `$&` (the whole match) and `$$` (a dollar sign), like
 * String.prototype.replace; other `$` sequences stay literal. Literal mode returns the replacement unchanged.
 */
export function expandReplacement(range: TextRange, replacement: string, regex: boolean | undefined): string {
  const caps = range.captures;
  if (!regex || !caps || !replacement.includes("$")) return replacement;
  return replacement.replace(/\$([$&1-9])/g, (all, c: string) => {
    if (c === "$") return "$";
    if (c === "&") return caps[0] ?? "";
    const n = Number(c);
    return n < caps.length ? (caps[n] ?? "") : all;
  });
}
