/** A run of text of a PDF page as pdf.js gives it (user space, y up): its text, its transform (the baseline start is `[4]`, `[5]`), width and height. */
export interface TextRun {
  str: string;
  transform: number[];
  width: number;
  height: number;
}

/** The words of a PDF page in the order the PDF draws them, and which of them is at a point. */
export interface WordClick {
  tokens: string[];
  index: number;
}

/**
 * The word at (`x`, `y`) of a PDF page (user space, y up) among all the words of its runs, or null when the point is on no text.
 * pdf.js gives a run per shaped piece of a line, not per word, so a run is split at spaces and its width shared out by characters
 * (an estimate: a click near the edge of a word can fall on its neighbour). Runs that are drawn sideways are not looked at.
 */
export function wordAtPoint(runs: readonly TextRun[], x: number, y: number): WordClick | null {
  const tokens: string[] = [];
  let hit: number | null = null;
  for (const run of runs) {
    const [a = 1, b = 0, , , e = 0, f = 0] = run.transform;
    const words = [...run.str.matchAll(/\S+/g)];
    if (hit === null && b === 0 && a !== 0 && run.width > 0 && run.str.length > 0) {
      const height = run.height || Math.abs(run.transform[3] ?? 0) || 10;
      const inLine = y >= f - height * 0.3 && y <= f + height;
      const left = Math.min(e, e + run.width);
      if (inLine && x >= left && x <= left + Math.abs(run.width)) {
        const at = Math.min(
          run.str.length - 1,
          Math.floor(((x - left) / Math.abs(run.width)) * run.str.length),
        );
        // The word the character is in, or the one after the space it is on.
        const k = words.findIndex((w) => w.index! + w[0].length > at);
        if (k >= 0) hit = tokens.length + k;
      }
    }
    for (const w of words) tokens.push(w[0]);
  }
  return hit === null ? null : { tokens, index: hit };
}
