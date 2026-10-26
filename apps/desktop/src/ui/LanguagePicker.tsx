import { useLingui } from "@lingui/react/macro";
import { useLocale } from "../i18n/i18n";
import { ENABLED_LOCALES, LOCALES, PSEUDO_LOCALE } from "../i18n/locales";

const options = [
  ...LOCALES.filter((l) => ENABLED_LOCALES.includes(l.code)).map((l) => ({ code: l.code, name: l.nativeName })),
  ...(import.meta.env.DEV ? [{ code: PSEUDO_LOCALE, name: "Pseudo (dev)" }] : []),
];

/** Language names are shown in their own language so a user can always find theirs. Hidden until a second language ships. */
export function LanguagePicker() {
  const { t } = useLingui();
  const { locale, setLocale } = useLocale();
  if (options.length < 2) return null;
  return (
    <select
      aria-label={t`Language`}
      value={locale}
      onChange={(e) => void setLocale(e.target.value)}
      className="rounded-md border border-border bg-bg px-2 py-1.5 text-[13px] font-semibold text-ink-muted focus-visible:outline-2 focus-visible:outline-accent"
    >
      {options.map((o) => <option key={o.code} value={o.code} lang={o.code === PSEUDO_LOCALE ? "en" : o.code}>{o.name}</option>)}
    </select>
  );
}
