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
