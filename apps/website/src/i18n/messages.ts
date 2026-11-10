import type { Locale } from "./config";
import { en, type Messages } from "./messages/en";

const catalogs: Record<Locale, Messages> = { en };

export function getMessages(locale: Locale): Messages {
  return catalogs[locale];
}

export type { Messages };
