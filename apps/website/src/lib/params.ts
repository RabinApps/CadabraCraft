import { notFound } from "next/navigation";
import { isLocale, type Locale } from "@/i18n/config";

export type LocaleParams<T = object> = { params: Promise<{ locale: string } & T> };

/** The validated locale of a `[locale]` route, or a 404. */
export async function getLocale(params: Promise<{ locale: string }>): Promise<Locale> {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  return locale;
}
