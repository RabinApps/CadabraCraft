/** Longest index term, subentry or cross-reference target, in characters. */
export const MAX_INDEX_TERM = 120;
/** Longest glossary term, in characters. */
export const MAX_GLOSSARY_TERM = 120;
/** Longest glossary definition, in characters. */
export const MAX_GLOSSARY_DEFINITION = 2000;
/** Most aliases a glossary entry can have. */
export const MAX_GLOSSARY_ALIASES = 12;

/** A term, subentry or target: some text, no line breaks, within `MAX_INDEX_TERM`. */
export const isValidIndexTerm = (v: unknown): v is string =>
  typeof v === "string" && v.trim().length > 0 && v.length <= MAX_INDEX_TERM && !/[\r\n]/.test(v);
