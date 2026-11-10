/** Locales the site is built for. Add a code here, a messages file and a `src/content/<locale>` folder to add a language. */
export const LOCALES = ["en"] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "en";

const RTL = new Set<string>(["ar", "he"]);

export function isLocale(value: string): value is Locale {
  return (LOCALES as readonly string[]).includes(value);
}

export function dirFor(locale: string): "ltr" | "rtl" {
  return RTL.has(locale) ? "rtl" : "ltr";
}

/** Prefix a site path ("/features/") with the locale ("/en/features/"). External and hash links pass through. */
export function localePath(locale: Locale, path: string): string {
  if (!path.startsWith("/") || path.startsWith("//")) return path;
  return `/${locale}${path}`;
}

/** Strip the locale prefix from a pathname, e.g. "/en/docs/" -> "/docs/". */
export function stripLocale(pathname: string): string {
  const m = /^\/([^/]+)(\/.*)?$/.exec(pathname);
  if (m?.[1] && isLocale(m[1])) return m[2] ?? "/";
  return pathname;
}
