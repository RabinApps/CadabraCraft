export type TextDirection = "ltr" | "rtl";

const RTL_LANGUAGES = new Set(["he", "ar", "fa", "ur", "ps", "sd", "yi", "dv", "ug"]);

/** Primary language subtag of a BCP 47 tag, lowercased ("ar-EG" -> "ar"). */
/* v8 ignore next -- split() always yields at least one element; ?? only satisfies noUncheckedIndexedAccess */
export const primaryLanguage = (tag: string): string => tag.toLowerCase().split(/[-_]/)[0] ?? "";

/** Base text direction for a BCP 47 tag (`manifest.language` or a UI locale). */
export function textDirection(tag: string): TextDirection {
  return RTL_LANGUAGES.has(primaryLanguage(tag)) ? "rtl" : "ltr";
}

/** Longest BCP 47 tag the `lang` mark accepts (the length RFC 5646 asks implementations to support). */
export const LANG_TAG_MAX = 35;

/** True for a tag the `lang` mark may carry: letters, digits and single hyphens between them, at most 35 characters. */
export const isLangTag = (tag: unknown): tag is string =>
  typeof tag === "string" &&
  tag.length <= LANG_TAG_MAX &&
  /^[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*$/.test(tag);

/** A tag split into what Typst's `text(lang:, region:)` takes ("fr-CA" gives fr and CA); null when the tag has no 2 or 3 letter language. */
export function langAndRegion(tag: string): { lang: string; region?: string } | null {
  const m = /^([A-Za-z]{2,3})(?:[-_]([A-Za-z]{2})(?![A-Za-z]))?/.exec(tag);
  if (!m) return null;
  const lang = m[1]!.toLowerCase();
  return m[2] ? { lang, region: m[2].toUpperCase() } : { lang };
}
