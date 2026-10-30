/**
 * Windows language identifiers (LCIDs), the numbers RTF's `\deflang` and `\lang` take. A full tag (`pt-BR`) is looked up first, then
 * the language alone, which maps to its most common region (`pt` is Portugal, as in Word's own default).
 */
const LCID: Record<string, number> = {
  en: 1033,
  "en-us": 1033,
  "en-gb": 2057,
  "en-au": 3081,
  "en-ca": 4105,
  "en-nz": 5129,
  "en-ie": 6153,
  "en-in": 16393,
  de: 1031,
  "de-at": 3079,
  "de-ch": 2055,
  fr: 1036,
  "fr-ca": 3084,
  "fr-ch": 4108,
  "fr-be": 2060,
  es: 3082,
  "es-mx": 2058,
  "es-ar": 11274,
  "es-us": 21514,
  it: 1040,
  "it-ch": 2064,
  pt: 2070,
  "pt-br": 1046,
  nl: 1043,
  "nl-be": 2067,
  sv: 1053,
  da: 1030,
  nb: 1044,
  no: 1044,
  fi: 1035,
  pl: 1045,
  cs: 1029,
  hu: 1038,
  ro: 1048,
  el: 1032,
  tr: 1055,
  ru: 1049,
  uk: 1058,
  ja: 1041,
  ko: 1042,
  zh: 2052,
  "zh-cn": 2052,
  "zh-tw": 1028,
  hi: 1081,
  id: 1057,
  vi: 1066,
  th: 1054,
  ca: 1027,
};

/** The Windows language id for a BCP 47 tag, or null when the language is not in the table (then no language is written). */
export function languageId(tag: string): number | null {
  const parts = tag.toLowerCase().replace(/_/g, "-").split("-");
  const primary = parts[0]!;
  // Only the language and region matter: a script or variant subtag between them is ignored (`zh-Hant-TW` is `zh-tw`).
  const region = parts.slice(1).find((p) => /^([a-z]{2}|\d{3})$/.test(p));
  const traditional = primary === "zh" && !region && parts.includes("hant");
  const key = traditional ? "zh-tw" : region ? `${primary}-${region}` : primary;
  return LCID[key] ?? LCID[primary] ?? null;
}
