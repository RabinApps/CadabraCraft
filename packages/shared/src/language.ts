export type TextDirection = "ltr" | "rtl";

const RTL_LANGUAGES = new Set(["he", "ar", "fa", "ur", "ps", "sd", "yi", "dv", "ug"]);

/** Primary language subtag of a BCP 47 tag, lowercased ("ar-EG" -> "ar"). */
export const primaryLanguage = (tag: string): string => tag.toLowerCase().split(/[-_]/)[0] ?? "";

/** Base text direction for a BCP 47 tag (`manifest.language` or a UI locale). */
export function textDirection(tag: string): TextDirection {
  return RTL_LANGUAGES.has(primaryLanguage(tag)) ? "rtl" : "ltr";
}
