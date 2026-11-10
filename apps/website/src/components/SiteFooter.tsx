import { localePath, type Locale } from "@/i18n/config";
import { getMessages } from "@/i18n/messages";
import { REPO } from "@/lib/site";

type Column = { heading: string; links: { label: string; href: string }[] };

export function SiteFooter({ locale }: { locale: Locale }) {
  const m = getMessages(locale);
  const link = (path: string) => localePath(locale, path);
  const columns: Column[] = [
    {
      heading: m.footer.product,
      links: [
        { label: m.nav.features, href: link("/features/") },
        { label: m.nav.formats, href: link("/formats/") },
        { label: m.footer.download, href: link("/download/") },
        { label: m.footer.changelog, href: link("/changelog/") },
      ],
    },
    {
      heading: m.footer.learn,
      links: [
        { label: m.nav.docs, href: link("/docs/") },
        { label: m.nav.guides, href: link("/guides/") },
        { label: m.nav.compare, href: link("/compare/") },
      ],
    },
    {
      heading: m.footer.project,
      links: [
        { label: m.footer.github, href: REPO },
        { label: m.nav.support, href: link("/support/") },
        { label: m.footer.accessibility, href: `${REPO}/blob/main/docs/accessibility-statement.md` },
        { label: m.footer.license, href: `${REPO}/blob/main/LICENSE` },
      ],
    },
  ];
  return (
    <footer className="border-t border-border bg-surface">
      <div className="mx-auto max-w-6xl px-4 pb-8 pt-12 sm:px-6">
        <div className="grid gap-10 md:grid-cols-[minmax(0,1.4fr)_repeat(3,minmax(0,1fr))]">
          <div>
            <a href={link("/")} className="inline-flex items-center gap-2.5 font-book text-xl font-semibold">
              <img src="/brand/cadabracraft-icon.svg" alt="" width={28} height={28} className="size-7" />
              CadabraCraft
            </a>
            <p className="mt-3 max-w-xs text-sm leading-relaxed text-ink-muted">{m.footer.tagline}</p>
          </div>
          {columns.map((c) => (
            <nav key={c.heading} aria-label={c.heading}>
              <p className="text-sm font-semibold">{c.heading}</p>
              <ul className="mt-3 space-y-2.5 text-sm text-ink-muted">
                {c.links.map((l) => (
                  <li key={l.href}>
                    <a href={l.href} className="hover:text-ink">
                      {l.label}
                    </a>
                  </li>
                ))}
              </ul>
            </nav>
          ))}
        </div>
        <p className="mt-10 text-xs leading-relaxed text-ink-muted">{m.footer.legal}</p>
      </div>
    </footer>
  );
}
