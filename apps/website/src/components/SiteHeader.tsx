import { btnPrimary, nav, REPO } from "@/lib/site";
import { ThemeToggle } from "./ThemeToggle";

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-10 border-b border-border bg-bg/85 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3 sm:px-6">
        <a href="/" className="flex items-center gap-2.5 font-book text-xl font-semibold">
          <img src="/brand/cadabracraft-icon.svg" alt="" width={28} height={28} className="size-7" />
          CadabraCraft
        </a>
        <nav aria-label="Main" className="flex items-center gap-4 text-sm">
          {nav.map((n) => (
            <a key={n.href} href={n.href} className="hidden text-ink-muted hover:text-ink sm:inline">
              {n.label}
            </a>
          ))}
          <a href={REPO} className="hidden text-ink-muted hover:text-ink md:inline">
            GitHub
          </a>
          <a href="/download/" className={`${btnPrimary} !py-1.5`}>
            Download
          </a>
          <ThemeToggle />
        </nav>
      </div>
    </header>
  );
}
