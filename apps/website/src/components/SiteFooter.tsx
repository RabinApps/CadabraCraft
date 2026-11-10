import { getContent } from "@/content";
import { localePath, type Locale } from "@/i18n/config";
import { getMessages } from "@/i18n/messages";
import { nav, REPO } from "@/lib/site";

export function SiteFooter({ locale }: { locale: Locale }) {
  const m = getMessages(locale);
  const { competitors } = getContent(locale).competitors;
  return (
    <footer className="border-t border-border">
      <div className="mx-auto grid max-w-6xl gap-8 px-4 py-10 text-sm text-ink-muted sm:grid-cols-3 sm:px-6">
        <div>
          <p className="font-book text-lg text-ink">CadabraCraft</p>
          <p className="mt-2">{m.footer.tagline}</p>
        </div>
        <nav aria-label="Footer" className="flex flex-col gap-2">
          {nav.map((n) => (
            <a key={n.key} href={localePath(locale, n.href)} className="hover:text-ink">
              {m.nav[n.key]}
            </a>
          ))}
          <a href={localePath(locale, "/download/")} className="hover:text-ink">
            {m.footer.download}
          </a>
          <a href={REPO} className="hover:text-ink">
            {m.footer.source}
          </a>
        </nav>
        <nav aria-label="Comparisons" className="flex flex-col gap-2">
          {competitors.map((c) => (
            <a key={c.slug} href={localePath(locale, `/compare/${c.slug}/`)} className="hover:text-ink">
              {m.footer.versus} {c.name}
            </a>
          ))}
        </nav>
      </div>
      <div className="mx-auto max-w-6xl px-4 pb-8 text-xs text-ink-muted sm:px-6">{m.footer.legal}</div>
    </footer>
  );
}
