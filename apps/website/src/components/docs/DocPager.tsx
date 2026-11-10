import { localePath, type Locale } from "@/i18n/config";
import type { Messages } from "@/i18n/messages";
import type { Entry } from "@/lib/docs/entries";

export function DocPager({ locale, prev, next, m }: { locale: Locale; prev?: Entry; next?: Entry; m: Messages }) {
  if (!prev && !next) return null;
  const cls = "block rounded-md border border-border p-4 hover:bg-sidebar";
  return (
    <nav aria-label={m.docs.sections} className="mt-14 grid gap-4 sm:grid-cols-2">
      {prev ? (
        <a href={localePath(locale, `/docs/${prev.slug}/`)} className={cls} rel="prev">
          <span className="block text-xs text-ink-muted">{m.docs.previous}</span>
          <span className="font-medium">{prev.title}</span>
        </a>
      ) : (
        <span />
      )}
      {next && (
        <a href={localePath(locale, `/docs/${next.slug}/`)} className={`${cls} sm:text-end`} rel="next">
          <span className="block text-xs text-ink-muted">{m.docs.next}</span>
          <span className="font-medium">{next.title}</span>
        </a>
      )}
    </nav>
  );
}
