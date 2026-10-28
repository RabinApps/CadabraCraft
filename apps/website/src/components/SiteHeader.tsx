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
          {nav
            .filter((n) => n.href !== "/support/")
            .map((n) => (
              <a key={n.href} href={n.href} className="hidden text-ink-muted hover:text-ink md:inline">
                {n.label}
              </a>
            ))}
          <a href={REPO} className="hidden text-ink-muted hover:text-ink lg:inline">
            GitHub
          </a>
          <span className="hidden md:inline-flex">
            <a href="/support/" className={`${btnPrimary} !py-1.5`}>
              Support
            </a>
          </span>
          <ThemeToggle />
        </nav>
        <details className="relative md:hidden">
          <summary className="cursor-pointer list-none rounded-md border border-border px-3 py-1.5 text-sm">
            Menu
          </summary>
          <div className="absolute right-0 mt-2 flex w-44 flex-col gap-1 rounded-lg border border-border bg-surface p-2 text-sm shadow-lg">
            {nav.map((n) => (
              <a key={n.href} href={n.href} className="rounded px-3 py-2 hover:bg-sidebar">
                {n.label}
              </a>
            ))}
            <a href={REPO} className="rounded px-3 py-2 hover:bg-sidebar">
              GitHub
            </a>
          </div>
        </details>
      </div>
    </header>
  );
}
