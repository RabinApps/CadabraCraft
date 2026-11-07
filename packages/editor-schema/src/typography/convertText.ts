import { convertDashes } from "./dashes";
import { decide } from "./decide";
import type { QuoteStyle } from "./quoteStyle";

/** What surrounds the text when it is a piece of a longer one: the character before it and the text after it. */
export interface TextContext {
  before?: string;
  after?: string;
}

/**
 * Turns straight quotes into the style's quotation marks and apostrophes, `--` and `---` into dashes and `...`
 * into an ellipsis. Text that is already typographic stays as it is, so converting twice changes nothing.
 */
export function convertText(text: string, style: QuoteStyle, context: TextContext = {}): string {
  const dashed = convertDashes(text);
  const after = context.after ?? "";
  let out = "";
  for (let i = 0; i < dashed.length; i += 1) {
    const ch = dashed.charAt(i);
    if (ch === '"' || ch === "'") {
      const prev = out === "" ? (context.before ?? "") : Array.from(out.slice(-2)).pop()!;
      out += decide(prev, ch, style, dashed.slice(i + 1) + after);
    } else out += ch;
  }
  return out;
}
