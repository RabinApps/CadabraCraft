import { SponsorBand } from "@/components/SponsorBand";
import { competitors } from "@/data/competitors";
import { pageMetadata } from "@/lib/seo";

export const metadata = pageMetadata(
  "Compare book formatting software",
  "Fair, dated, side-by-side comparisons of CadabraCraft, a free, source-available book formatter, with popular alternatives.",
  "/compare/",
);

export default function CompareIndex() {
  return (
    <>
      <section className="mx-auto max-w-4xl px-4 py-16 sm:px-6">
        <h1 className="font-book text-4xl font-medium sm:text-5xl">Compare CadabraCraft</h1>
        <p className="mt-4 text-lg text-ink-muted">
          Looking for a free alternative to paid book formatters, or just choosing your tools? These pages stick to
          facts the vendors state publicly, each dated and sourced.
        </p>
        <ul className="mt-10 grid gap-4 sm:grid-cols-2">
          {competitors.map((c) => (
            <li key={c.slug}>
              <a
                href={`/compare/${c.slug}/`}
                className="block rounded-lg border border-border bg-surface p-6 hover:bg-sidebar"
              >
                <h2 className="font-semibold">CadabraCraft vs {c.name}</h2>
                <p className="mt-2 text-sm text-ink-muted">{c.tagline}</p>
              </a>
            </li>
          ))}
        </ul>
      </section>
      <SponsorBand title="Free forever. Help keep it that way." />
    </>
  );
}
