import { langAndRegion } from "@cadabracraft/shared";

/** The glyphs one language writes quotation marks with. The apostrophe is always {@link APOSTROPHE}. */
export interface QuoteStyle {
  open: string;
  close: string;
  /** The inner pair: what the single quote key produces at the start and the end of a quotation. */
  openSingle: string;
  closeSingle: string;
}

/** The typographic apostrophe, used by every language (also for a single quote after a letter). */
export const APOSTROPHE = "’";

const NNBSP = " ";

const english: QuoteStyle = {
  open: "“",
  close: "”",
  openSingle: "‘",
  closeSingle: "’",
};
const german: QuoteStyle = {
  open: "„",
  close: "“",
  openSingle: "‚",
  closeSingle: "‘",
};
/** Swiss German and Swiss French: guillemets without spaces, single guillemets inside. */
const swiss: QuoteStyle = {
  open: "«",
  close: "»",
  openSingle: "‹",
  closeSingle: "›",
};
/** French sets the guillemets off with a narrow no-break space; the inner pair is the curly English pair. */
const french: QuoteStyle = {
  open: `«${NNBSP}`,
  close: `${NNBSP}»`,
  openSingle: "“",
  closeSingle: "”",
};
/** Spanish: guillemets, with the curly double pair nested inside. */
const spanish: QuoteStyle = {
  open: "«",
  close: "»",
  openSingle: "“",
  closeSingle: "”",
};
/** Italian: guillemets (no spaces), curly single quotes inside. */
const italian: QuoteStyle = {
  open: "«",
  close: "»",
  openSingle: "‘",
  closeSingle: "’",
};

const byLanguage: Record<string, QuoteStyle> = { de: german, fr: french, es: spanish, it: italian };
const byRegion: Record<string, QuoteStyle> = { "de-CH": swiss, "fr-CH": swiss };

/**
 * The quotation marks for a BCP 47 tag. Hebrew and Arabic use the English-style curly pair; every language that
 * has no entry (and a tag that is not a language) falls back to English.
 */
export function quoteStyle(tag: string): QuoteStyle {
  const parts = langAndRegion(tag);
  if (!parts) return english;
  const regional = parts.region ? byRegion[`${parts.lang}-${parts.region}`] : undefined;
  return regional ?? byLanguage[parts.lang] ?? english;
}
