import { primaryLanguage } from "../language";

/**
 * The words before an index cross-reference: `[see, see also]` ("See Magic", "See also Magic"). MACHINE-DRAFTED translations (not by
 * a native speaker): native review is a release blocker, see docs/roadmap.md.
 */
const SEE_WORDS: Record<string, [string, string]> = {
  en: ["See", "See also"],
  he: ["ראו", "ראו גם"],
  ar: ["انظر", "انظر أيضًا"],
  it: ["Vedi", "Vedi anche"],
  ja: ["参照", "関連項目"],
  ru: ["См.", "См. также"],
  fr: ["Voir", "Voir aussi"],
  de: ["Siehe", "Siehe auch"],
  es: ["Véase", "Véase también"],
};

/** The words for a language, or undefined when there is no translation (an exporter that must not fall back to English can refuse). */
export const seeWordsFor = (language: string | undefined): [string, string] | undefined =>
  SEE_WORDS[primaryLanguage(language ?? "")];

/** The words for a language, in English when there is no translation: an export must not fail over a label. */
export const seeWords = (language: string | undefined): [string, string] =>
  seeWordsFor(language) ?? SEE_WORDS.en!;
