import { i18n, type Messages } from "@lingui/core";
import { create } from "zustand";
import { DEFAULT_LOCALE, dirFor, isLoadable, resolveLocale } from "./locales";

const KEY = "cadabracraft.locale";

const catalogs = import.meta.glob<{ messages: Messages }>(
  "./locales/*/messages.po",
);

/** App preference only; never stored in project files. */
export function readLocale(): string {
  try {
    const v = localStorage.getItem(KEY);
    if (v && isLoadable(v)) return v;
  } catch {
    /* storage unavailable: fall through to detection */
  }
  return resolveLocale(typeof navigator === "undefined" ? [] : navigator.languages);
}

export function applyLocale(code: string) {
  document.documentElement.lang = code === "pseudo" ? DEFAULT_LOCALE : code;
  document.documentElement.dir = dirFor(code);
}

export async function activateLocale(code: string) {
  const load = catalogs[`./locales/${code}/messages.po`];
  if (!load) throw new Error(`No catalog for locale "${code}"`);
  i18n.load(code, (await load()).messages);
  i18n.activate(code);
  applyLocale(code);
}

export const useLocale = create<{ locale: string; setLocale: (code: string) => Promise<void> }>(
  (set) => ({
    locale: DEFAULT_LOCALE,
    setLocale: async (code) => {
      if (!isLoadable(code)) return;
      await activateLocale(code);
      try { localStorage.setItem(KEY, code); } catch { /* keep in memory */ }
      set({ locale: code });
    },
  }),
);

/** Call once before first render. */
export async function initI18n() {
  const code = readLocale();
  await activateLocale(code);
  useLocale.setState({ locale: code });
}

export { i18n };
