import { localePath, type Locale } from "@/i18n/config";
import { getMessages } from "@/i18n/messages";
import { btnPrimary, nav, REPO } from "@/lib/site";
import { MobileMenu } from "./MobileMenu";
import { LocaleSwitcher } from "./LocaleSwitcher";
import { ThemeToggle } from "./ThemeToggle";

const iconBtn = "inline-flex items-center justify-center rounded-md p-2 text-ink-muted hover:bg-sidebar hover:text-ink";
const stroke = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round",
  strokeLinejoin: "round",
} as const;

function GithubIcon() {
  return (
    <svg aria-hidden viewBox="0 0 24 24" className="size-5" {...stroke}>
      <path d="M15 22v-4a4.8 4.8 0 0 0-1-3.5c3 0 6-2 6-5.5.08-1.25-.27-2.48-1-3.5.28-1.15.28-2.35 0-3.5 0 0-1 0-3 1.5-2.64-.5-5.36-.5-8 0C6 2 5 2 5 2c-.3 1.15-.3 2.35 0 3.5A5.4 5.4 0 0 0 4 9c0 3.5 3 5.5 6 5.5-.39.49-.68 1.05-.85 1.65S8.93 17.38 9 18v4" />
      <path d="M9 18c-4.51 2-5-2-7-2" />
    </svg>
  );
}

function DownloadIcon() {
  return (
    <svg aria-hidden viewBox="0 0 24 24" className="size-4" {...stroke}>
      <path d="M12 3v12m0 0 4-4m-4 4-4-4M4 21h16" />
    </svg>
  );
}

export function SiteHeader({ locale }: { locale: Locale }) {
  const m = getMessages(locale);
  const link = (href: string) => localePath(locale, href);
  const links = nav.filter((n) => n.key !== "support");
  return (
    <header className="sticky top-0 z-10 border-b border-border bg-bg/85 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
        <a href={link("/")} className="flex shrink-0 items-center gap-2.5 font-book text-xl font-semibold">
          <img src="/brand/cadabracraft-icon.svg" alt="" width={28} height={28} className="size-7" />
          CadabraCraft
        </a>
        <nav aria-label={m.header.main} className="flex items-center gap-1 text-sm sm:gap-2">
          <ul className="mr-3 hidden items-center gap-6 lg:flex">
            {links.map((n) => (
              <li key={n.key}>
                <a href={link(n.href)} className="text-ink-muted hover:text-ink">
                  {m.nav[n.key]}
                </a>
              </li>
            ))}
          </ul>
          <a
            href={REPO}
            aria-label={m.header.github}
            title={m.header.github}
            className={`${iconBtn} max-lg:hidden`}
          >
            <GithubIcon />
          </a>
          <LocaleSwitcher locale={locale} />
          <ThemeToggle labels={m.theme} />
          <a href={link("/download/")} className={`${btnPrimary} ml-2 gap-2 !py-1.5 max-sm:hidden`}>
            <DownloadIcon />
            {m.header.download}
          </a>
          <MobileMenu
            label={m.header.menu}
            links={[...links.map((n) => ({ href: link(n.href), label: m.nav[n.key] })), { href: REPO, label: m.header.github }]}
            cta={{ href: link("/download/"), label: m.header.download }}
          />
        </nav>
      </div>
    </header>
  );
}
