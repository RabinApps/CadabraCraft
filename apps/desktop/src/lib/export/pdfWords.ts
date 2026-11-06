/** A run of text of a PDF page as pdf.js gives it (user space, y up): its text, its transform (the baseline start is `[4]`, `[5]`), width and height. */
export interface TextRun {
  str: string;
  transform: number[];
  width: number;
  height: number;
  /** The direction pdf.js found for the run ("rtl", "ltr" or "ttb"); without it, the run's letters decide. */
  dir?: string;
}

/** The words of a PDF page in reading order, and which of them is at a point. */
export interface WordClick {
  tokens: string[];
  index: number;
}

/** Hebrew, Arabic and the other scripts written right to left (letters of those blocks, and the Arabic presentation forms). */
const RTL_LETTER = /[\u0590-\u08ff\ufb1d-\ufdff\ufe70-\ufefc]/;

const isRtl = (run: TextRun): boolean =>
  run.dir === undefined ? RTL_LETTER.test(run.str) : run.dir === "rtl";

/** Points below its baseline a run still counts as under the point (a descender is about a third of a text size of 9 to 12 pt). */
const MAX_DESCENT = 4;

const baseline = (run: TextRun): number => run.transform[5] ?? 0;
const left = (run: TextRun): number =>
  Math.min(run.transform[4] ?? 0, (run.transform[4] ?? 0) + run.width);

/**
 * The runs of a page in reading order. pdf.js lists a line's runs as they are drawn, left to right on the page; in a right-to-left
 * line that is the reverse of reading order (the text inside a run is already in logical order, and so are the lines, top to
 * bottom). A line is the runs in a row with the same baseline; one with any right-to-left run is read from its right edge, runs of
 * left-to-right text inside it (a number, a quoted name) staying whole. Other lines are left as they are.
 */
function readingOrder(runs: readonly TextRun[]): TextRun[] {
  const out: TextRun[] = [];
  let i = 0;
  while (i < runs.length) {
    const first = runs[i]!;
    const tolerance = Math.max(1, (first.height || 10) * 0.3);
    let j = i + 1;
    while (j < runs.length && Math.abs(baseline(runs[j]!) - baseline(first)) <= tolerance) j++;
    const line = runs.slice(i, j);
    out.push(...(line.some(isRtl) ? [...line].sort((a, b) => left(b) - left(a)) : line));
    i = j;
  }
  return out;
}

/**
 * The word at (`x`, `y`) of a PDF page (user space, y up) among all the words of its runs in reading order, or null when the point
 * is on no text. pdf.js gives a run per shaped piece of a line, not per word, so a run is split at spaces and its width shared out
 * by characters (an estimate: a click near the edge of a word can fall on its neighbour); in a right-to-left run the characters
 * are counted from its right edge, as its text is in logical order. Runs that are drawn sideways are not looked at.
 */
export function wordAtPoint(runs: readonly TextRun[], x: number, y: number): WordClick | null {
  const tokens: string[] = [];
  let hit: number | null = null;
  for (const run of readingOrder(runs)) {
    const words = [...run.str.matchAll(/\S+/g)];
    if (hit === null) {
      const k = wordIndexInRun(run, words, x, y);
      if (k >= 0) hit = tokens.length + k;
    }
    for (const w of words) tokens.push(w[0]);
  }
  return hit === null ? null : { tokens, index: hit };
}

/** The index among `words` of the word of `run` at (`x`, `y`), or -1 when the run is drawn sideways or the point is not on it. */
function wordIndexInRun(run: TextRun, words: RegExpMatchArray[], x: number, y: number): number {
  const [a = 1, b = 0, , , e = 0, f = 0] = run.transform;
  if (!(b === 0 && a !== 0 && run.width > 0 && run.str.length > 0)) return -1;
  const height = run.height || Math.abs(run.transform[3] ?? 0) || 10;
  // Room below the baseline for descenders; a large run (a drop cap) has its words beside and under it, so the room is capped.
  const inLine = y >= f - Math.min(height * 0.3, MAX_DESCENT) && y <= f + height;
  const edge = Math.min(e, e + run.width);
  const width = Math.abs(run.width);
  if (!inLine || x < edge || x > edge + width) return -1;
  const along = isRtl(run) ? edge + width - x : x - edge;
  const at = Math.min(run.str.length - 1, Math.floor((along / width) * run.str.length));
  // The word the character is in, or the one after the space it is on.
  return words.findIndex((w) => w.index! + w[0].length > at);
}
