import { primaryLanguage } from "@cadabracraft/shared";

/** Reader-visible text the exporter itself writes (not book content). */
const CONTENTS: Record<string, string> = {
  en: "Contents",
  he: "תוכן העניינים",
  ar: "المحتويات",
  it: "Indice",
  ja: "目次",
  ru: "Содержание",
  fr: "Table des matières",
  de: "Inhaltsverzeichnis",
  es: "Índice",
};

/** Heading for the navigation document. Throws for languages we have no translation for, never falls back to English. */
export function contentsHeading(language: string): string {
  const s = CONTENTS[primaryLanguage(language)];
  if (!s) throw new Error(`export-epub: no "Contents" translation for language "${language}"; add one in strings.ts`);
  return s;
}

const LANDMARKS: Record<string, string> = {
  en: "Landmarks",
  he: "ציוני דרך",
  ar: "معالم",
  it: "Punti di riferimento",
  ja: "ランドマーク",
  ru: "Ориентиры",
  fr: "Repères",
  de: "Orientierungspunkte",
  es: "Puntos de referencia",
};

const START_OF_CONTENT: Record<string, string> = {
  en: "Start of content",
  he: "תחילת התוכן",
  ar: "بداية المحتوى",
  it: "Inizio del contenuto",
  ja: "本文の開始",
  ru: "Начало содержимого",
  fr: "Début du contenu",
  de: "Beginn des Inhalts",
  es: "Inicio del contenido",
};

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

function pick(table: Record<string, string>, what: string, language: string): string {
  const s = table[primaryLanguage(language)];
  if (!s) throw new Error(`export-epub: no "${what}" translation for language "${language}"; add one in strings.ts`);
  return s;
}

/** Heading of the (hidden) landmarks navigation. Throws for languages without a translation. */
export const landmarksHeading = (language: string): string => pick(LANDMARKS, "Landmarks", language);

/** Label of the "start of content" landmark. Throws for languages without a translation. */
export const startOfContentLabel = (language: string): string => pick(START_OF_CONTENT, "Start of content", language);

/** Label of the "cover" landmark and alt text prefix of the cover page. Throws for languages without a translation. */
export const coverLabel = (language: string): string => pick(COVER, "Cover", language);
