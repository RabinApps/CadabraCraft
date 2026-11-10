import { seeWordsFor } from "@cadabracraft/shared";

function words(language: string): [string, string] {
  const w = seeWordsFor(language);
  if (!w)
    throw new Error(
      `export-epub: no "See" translation for language "${language}"; add one in packages/shared/src/indexing/words.ts`,
    );
  return w;
}

/** The word before a cross-reference ("See Magic"). Throws for languages without a translation, never falls back to English. */
export const seeLabel = (language: string): string => words(language)[0];

/** The words before a related cross-reference ("See also Magic"). Throws for languages without a translation. */
export const seeAlsoLabel = (language: string): string => words(language)[1];
