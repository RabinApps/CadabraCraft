import type { Locale } from "@/i18n/config";
import * as changelog from "./en/changelog";
import * as competitors from "./en/competitors";
import * as content from "./en/content";

const en = { changelog, competitors, content };
export type ContentBundle = typeof en;

const bundles: Record<Locale, ContentBundle> = { en };

/** Marketing data for a locale. Add a `src/content/<locale>/` folder with the same modules and register it here. */
export function getContent(locale: Locale): ContentBundle {
  return bundles[locale];
}
