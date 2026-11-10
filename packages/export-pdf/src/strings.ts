import { primaryLanguage } from "@cadabracraft/shared";

/** Alt text of the cover image, which a screen reader reads from a tagged (PDF/UA) file. Same words as the EPUB export's cover. */
const COVER: Record<string, string> = {
  en: "Cover",
  he: "כריכה",
  ar: "الغلاف",
  it: "Copertina",
  ja: "表紙",
  ru: "Обложка",
  fr: "Couverture",
  de: "Umschlag",
  es: "Portada",
};

/** Alt text for the cover in the book's language. Other languages get the English word: an export must not fail over a label. */
export function coverAlt(language: string | undefined): string {
  return COVER[primaryLanguage(language ?? "")] ?? "Cover";
}

/** `[see, see also]` before an index cross-reference, in the book's language (English when there is no translation). */
export { seeWords } from "@cadabracraft/shared";
