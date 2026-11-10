"use client";

import { usePathname } from "next/navigation";
import { LOCALES, localePath, stripLocale, type Locale } from "@/i18n/config";

/** Native language names; add an entry when a locale is added. */
const NAMES: Record<Locale, string> = { en: "English" };

/** Links to the same page in each other language. Renders nothing while only one language exists. */
export function LocaleSwitcher({ locale }: { locale: Locale }) {
  const pathname = usePathname();
  if (LOCALES.length < 2) return null;
  const rest = stripLocale(pathname);
  return (
    <details className="relative">
      <summary className="cursor-pointer list-none rounded-md border border-border bg-surface px-3 py-1.5 text-sm text-ink-muted hover:text-ink">
        {NAMES[locale]}
      </summary>
      <ul className="absolute end-0 mt-2 w-40 rounded-lg border border-border bg-surface p-2 text-sm shadow-lg">
        {LOCALES.map((l) => (
          <li key={l}>
            <a
              href={localePath(l, rest)}
              hrefLang={l}
              lang={l}
              aria-current={l === locale ? "true" : undefined}
              className="block rounded px-3 py-2 hover:bg-sidebar"
            >
              {NAMES[l]}
            </a>
          </li>
        ))}
      </ul>
    </details>
  );
}
