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

/** Add a code here once its catalog is translated and reviewed. */
export const ENABLED_LOCALES: string[] = ["en"];

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
