import { InputRule } from "@tiptap/core";
import { charBefore, langMarkAt } from "./context";
import { EM_DASH, ELLIPSIS, EN_DASH } from "./dashes";
import { decide, type QuoteKey } from "./decide";
import { APOSTROPHE, quoteStyle } from "./quoteStyle";
import { TYPED_ELISION_DECADE, TYPED_ELISION_WORD } from "./elision";

/** What the typing rules need from the app, read on every keystroke so a setting change needs no new editor. */
export interface SmartTypographyOptions {
  /** The author's switch (Settings). While false no rule changes anything. */
  enabled: () => boolean;
  /** The language of the edition being written (BCP 47); a `lang` mark at the caret wins over it. */
  language: () => string;
}

type Handler = ConstructorParameters<typeof InputRule>[0]["handler"];
type HandlerProps = Parameters<Handler>[0];

/**
 * Replaces the matched range with `glyph(props)`, keeping the marks of the typed text, when the setting is on and the
 * typed text is not code. TipTap skips code that is already in the document; the check here also covers the first key
 * typed with the code mark switched on in an empty paragraph (the mark is only stored, no node carries it yet).
 *
 * `replaceWith`, not `insertText`: when the range is all of a paragraph's content (a quote typed in an empty paragraph)
 * `insertText` replaces the whole paragraph and the caret jumps to the start of the document.
 */
const converting =
  (options: SmartTypographyOptions, glyph: (props: HandlerProps) => string): Handler =>
  (props) => {
    const { tr } = props.state;
    const marks = tr.doc.resolve(props.range.to).nodeBefore!.marks;
    if (!options.enabled() || marks.some((m) => m.type.spec.code)) return null;
    const text = glyph(props);
    tr.replaceWith(props.range.from, props.range.to, tr.doc.type.schema.text(text, marks));
    return undefined;
  };

/** An input rule that replaces what it matched with `replacement(match)`. */
const replacing = (
  find: RegExp,
  options: SmartTypographyOptions,
  replacement: (match: RegExpMatchArray) => string,
): InputRule =>
  new InputRule({ find, handler: converting(options, ({ match }) => replacement(match)) });

/**
 * Smart typography while typing: quotes, `--` (en dash), `---` (em dash) and `...` (ellipsis). Inside the code mark
 * or a code block, and while an IME composes, TipTap runs no rule at all. Backspace right after a conversion
 * restores what was typed (the rules are undoable by default).
 */
export function typographyRules(options: SmartTypographyOptions): InputRule[] {
  const quote = converting(options, ({ state, range, match }) => {
    const $from = state.doc.resolve(range.from);
    const style = quoteStyle(langMarkAt($from) ?? options.language());
    return decide(charBefore($from), match[0] as QuoteKey, style);
  });
  return [
    replacing(TYPED_ELISION_WORD, options, (m) => `${APOSTROPHE}${m[1]}${m[2]}`),
    replacing(TYPED_ELISION_DECADE, options, (m) => `${APOSTROPHE}${m[1]}s`),
    new InputRule({ find: /["']$/, handler: quote }),
    replacing(/–-$/, options, () => EM_DASH),
    replacing(/--$/, options, () => EN_DASH),
    replacing(/\.\.\.$/, options, () => ELLIPSIS),
  ];
}
