/** A sentence, or a piece of one, as offsets into the text it came from (`end` is exclusive). */
export interface Span {
  start: number;
  end: number;
}

/** The longest text one speech call reads. A longer sentence is cut at a space (the engine drops text past about 510 tokens). */
export const MAX_SPEECH_CHARS = 300;

const SENTENCE = /[^.!?…]+(?:[.!?…]+["')\]”’]*)?/g;
const SPACE = /\s/;

/** Moves `at` forward past white space, stopping at `end`. */
function skipSpace(text: string, at: number, end: number): number {
  let i = at;
  while (i < end && SPACE.test(text[i]!)) i++;
  return i;
}

/** Cuts [start, end) into pieces of at most `max` characters, at a space when one is near the limit. */
function clip(text: string, start: number, end: number, max: number): Span[] {
  const out: Span[] = [];
  let from = start;
  while (end - from > max) {
    const space = text.slice(from, from + max).lastIndexOf(" ");
    const stop = from + (space > max / 2 ? space : max);
    let pieceEnd = stop;
    while (pieceEnd > from && SPACE.test(text[pieceEnd - 1]!)) pieceEnd--;
    out.push({ start: from, end: pieceEnd });
    from = skipSpace(text, stop, end);
  }
  if (from < end) out.push({ start: from, end });
  return out;
}

/**
 * The sentences of a text, in order, with white space trimmed. A sentence ends at . ! ? or an ellipsis (with any closing
 * quote or bracket). Text with no sentence punctuation is one sentence. Each one is at most `max` characters.
 */
export function splitSentences(text: string, max = MAX_SPEECH_CHARS): Span[] {
  const out: Span[] = [];
  for (const m of text.matchAll(SENTENCE)) {
    const begin = m.index ?? 0;
    const start = skipSpace(text, begin, begin + m[0].length);
    let end = begin + m[0].length;
    while (end > start && SPACE.test(text[end - 1]!)) end--;
    if (end > start) out.push(...clip(text, start, end, max));
  }
  return out;
}
