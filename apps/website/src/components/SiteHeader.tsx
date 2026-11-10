import { localePath, type Locale } from "@/i18n/config";
import { getMessages } from "@/i18n/messages";
import { btnPrimary, nav, REPO } from "@/lib/site";
import { LocaleSwitcher } from "./LocaleSwitcher";
import { ThemeToggle } from "./ThemeToggle";

export function SiteHeader({ locale }: { locale: Locale }) {
  const m = getMessages(locale);
  const link = (href: string) => localePath(locale, href);
  return (
    <header className="sticky top-0 z-10 border-b border-border bg-bg/85 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3 sm:px-6">
        <a href={link("/")} className="flex items-center gap-2.5 font-book text-xl font-semibold">
          <img src="/brand/cadabracraft-icon.svg" alt="" width={28} height={28} className="size-7" />
          CadabraCraft
        </a>
        <nav aria-label="Main" className="flex items-center gap-4 text-sm">
          {nav
            .filter((n) => n.key !== "support")
            .map((n) => (
              <a key={n.key} href={link(n.href)} className="hidden text-ink-muted hover:text-ink md:inline">
                {m.nav[n.key]}
              </a>
            ))}
          <a href={REPO} className="hidden text-ink-muted hover:text-ink lg:inline">
            {m.header.github}
          </a>
          <span className="hidden md:inline-flex">
            <a href={link("/support/")} className={`${btnPrimary} !py-1.5`}>
              {m.nav.support}
            </a>
          </span>
          <LocaleSwitcher locale={locale} />
          <ThemeToggle />
        </nav>
        <details className="relative md:hidden">
          <summary className="cursor-pointer list-none rounded-md border border-border px-3 py-1.5 text-sm">
            {m.header.menu}
          </summary>
          <div className="absolute end-0 mt-2 flex w-44 flex-col gap-1 rounded-lg border border-border bg-surface p-2 text-sm shadow-lg">
            {nav.map((n) => (
              <a key={n.key} href={link(n.href)} className="rounded px-3 py-2 hover:bg-sidebar">
                {m.nav[n.key]}
              </a>
            ))}
            <a href={REPO} className="rounded px-3 py-2 hover:bg-sidebar">
              {m.header.github}
            </a>
          </div>
        </details>
      </div>
    </header>
  );
}
