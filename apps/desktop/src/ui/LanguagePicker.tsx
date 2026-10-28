import { ENABLED_LOCALES, LOCALES, PSEUDO_LOCALE } from "../i18n/locales";

/** Language names are shown in their own language so a user can always find theirs. */
export const languageOptions = [
  ...LOCALES.filter((l) => ENABLED_LOCALES.includes(l.code)).map((l) => ({
    code: l.code,
    name: l.nativeName,
  })),
  ...(import.meta.env.DEV ? [{ code: PSEUDO_LOCALE, name: "Pseudo (dev)" }] : []),
];
