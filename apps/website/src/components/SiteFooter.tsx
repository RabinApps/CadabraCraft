import { competitors } from "@/data/competitors";
import { nav, REPO } from "@/lib/site";

export function SiteFooter() {
  return (
    <footer className="border-t border-border">
      <div className="mx-auto grid max-w-6xl gap-8 px-4 py-10 text-sm text-ink-muted sm:grid-cols-3 sm:px-6">
        <div>
          <p className="font-book text-lg text-ink">CadabraCraft</p>
          <p className="mt-2">Free, open-source book writing and formatting.</p>
        </div>
        <nav aria-label="Footer" className="flex flex-col gap-2">
          {nav.map((n) => (
            <a key={n.href} href={n.href} className="hover:text-ink">
              {n.label}
            </a>
          ))}
          <a href="/download/" className="hover:text-ink">
            Download
          </a>
          <a href={REPO} className="hover:text-ink">
            Source on GitHub
          </a>
        </nav>
        <nav aria-label="Comparisons" className="flex flex-col gap-2">
          {competitors.map((c) => (
            <a key={c.slug} href={`/compare/${c.slug}/`} className="hover:text-ink">
              CadabraCraft vs {c.name}
            </a>
          ))}
        </nav>
      </div>
      <div className="mx-auto max-w-6xl px-4 pb-8 text-xs text-ink-muted sm:px-6">
        © RabinApps. Vellum, Atticus, Scrivener and Reedsy are trademarks of their
        owners; they are named only for comparison.
      </div>
    </footer>
  );
}
