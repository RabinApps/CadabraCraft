import { startsWithElision } from "./elision";
import { APOSTROPHE, type QuoteStyle } from "./quoteStyle";

/** The quote keys. */
export type QuoteKey = '"' | "'";

const structural = new Set([..."\"'([{–—"]);

/** Start of a block, whitespace, an opening bracket, a dash or an opening quote of this style: a quote here opens. */
const isOpeningContext = (prev: string, style: QuoteStyle): boolean =>
  prev === "" ||
  /\s/u.test(prev) ||
  structural.has(prev) ||
  [...style.open, ...style.openSingle].includes(prev);

const isLetter = (ch: string): boolean => /\p{L}/u.test(ch);

/**
 * The glyph for a typed straight quote. `prev` is the character before it ("" at the start of a block).
 * `rest` is the text after it when it is known (converting existing text); while typing it is undefined.
 *
 * - After a digit it stays as typed: 5'10" is feet and inches.
 * - At the start of a block, after whitespace, an opening bracket, a dash or another opening quote it opens
 *   (but 'tis and '90s, known with `rest`, are apostrophes).
 * - A single quote after a letter is an apostrophe; with `rest` known and no letter following, it closes the quotation.
 * - Anything else closes.
 */
export function decide(prev: string, quote: QuoteKey, style: QuoteStyle, rest?: string): string {
  if (/\p{N}/u.test(prev)) return quote;
  const single = quote === "'";
  if (isOpeningContext(prev, style)) {
    if (single && rest !== undefined && startsWithElision(rest)) return APOSTROPHE;
    return single ? style.openSingle : style.open;
  }
  if (!single) return style.close;
  if (isLetter(prev) && (rest === undefined || isLetter(rest.charAt(0)))) return APOSTROPHE;
  return style.closeSingle;
}
