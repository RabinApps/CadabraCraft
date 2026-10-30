import { primaryLanguage, textDirection, type TextDirection } from "@cadabracraft/shared";

export type Dir = TextDirection;

export interface LocaleInfo {
  code: string;
  /** Shown in the language picker, in the language itself. */
  nativeName: string;
  dir: Dir;
}

/** Every language we plan to support. Only `ENABLED_LOCALES` appear in the picker. */
export const LOCALES: LocaleInfo[] = [
  { code: "en", nativeName: "English", dir: "ltr" },
  { code: "he", nativeName: "עברית", dir: "rtl" },
  { code: "ar", nativeName: "العربية", dir: "rtl" },
  { code: "it", nativeName: "Italiano", dir: "ltr" },
  { code: "ja", nativeName: "日本語", dir: "ltr" },
  { code: "ru", nativeName: "Русский", dir: "ltr" },
  { code: "fr", nativeName: "Français", dir: "ltr" },
  { code: "de", nativeName: "Deutsch", dir: "ltr" },
  { code: "es", nativeName: "Español", dir: "ltr" },
];

/** Languages in the picker. The 1.0 catalogs are machine drafts that still need native review (docs/roadmap.md). */
export const ENABLED_LOCALES: string[] = ["en", "es", "it", "fr", "de", "he", "ar"];

/** The locales a book language can be picked from (UI-enabled ones). */
export const ENABLED_LOCALE_INFO: LocaleInfo[] = LOCALES.filter((l) =>
  ENABLED_LOCALES.includes(l.code),
);

/** Dev-only locale that expands and accents every message. */
export const PSEUDO_LOCALE = "pseudo";

export const DEFAULT_LOCALE = "en";

/** Text direction for any BCP 47 tag (UI locale or `manifest.language`). */
export const dirFor: (tag: string) => Dir = textDirection;

export function isLoadable(code: string): boolean {
  return ENABLED_LOCALES.includes(code) || (import.meta.env.DEV && code === PSEUDO_LOCALE);
}

/** First enabled locale matching the browser's preferred languages, else the default. */
export function resolveLocale(preferred: readonly string[]): string {
  for (const tag of preferred) {
    const code = primaryLanguage(tag);
    if (ENABLED_LOCALES.includes(code)) return code;
  }
  return DEFAULT_LOCALE;
}
