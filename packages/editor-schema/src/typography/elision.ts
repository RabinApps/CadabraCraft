/** Words that start with an apostrophe because letters were dropped ('tis, 'til, 'em), not with an opening quote. */
export const ELISION_WORDS = [
  "tis",
  "twas",
  "twere",
  "twill",
  "twould",
  "til",
  "cause",
  "em",
  "bout",
  "round",
] as const;

const words = ELISION_WORDS.join("|");

/** Matches what follows a leading apostrophe when it is an elision: a listed word, or a decade ('90s). */
const elision = new RegExp(`^(?:(?:${words})(?![\\p{L}\\p{N}])|\\d\\ds(?![\\p{L}\\p{N}]))`, "iu");

/** True when `rest` (the text after a single quote) is an elision, so the quote is an apostrophe. */
export const startsWithElision = (rest: string): boolean => elision.test(rest);

/** Typing: a listed word just ended after an opening single quote (group 1 is the word, 2 what ended it). */
export const TYPED_ELISION_WORD = new RegExp(`‘(${words})([\\s.,;:!?)\\]])$`, "i");
/** Typing: the `s` of a decade after an opening single quote (group 1 is the two digits). */
export const TYPED_ELISION_DECADE = /‘(\d\d)s$/;
