import { notFound } from "next/navigation";
import { ComparisonTable } from "@/components/ComparisonTable";
import { JsonLd } from "@/components/JsonLd";
import { SponsorBand } from "@/components/SponsorBand";
import { competitors, getCompetitor } from "@/data/competitors";
import { pageMetadata } from "@/lib/seo";
import { btnPrimary, SITE_URL } from "@/lib/site";

type Params = { slug: string };

export const dynamicParams = false;

export function generateStaticParams(): Params[] {
  return competitors.map((c) => ({ slug: c.slug }));
}

export async function generateMetadata({ params }: { params: Promise<Params> }) {
  const c = getCompetitor((await params).slug);
  if (!c) return {};
  return pageMetadata(
    `CadabraCraft vs ${c.name}: free, open-source alternative compared`,
    `Fair comparison of CadabraCraft and ${c.name}: price, platforms, local files, EPUB3 and print PDF. Facts checked ${c.checkedOn}.`,
    `/compare/${c.slug}/`,
  );
}

export default async function ComparePage({ params }: { params: Promise<Params> }) {
  const c = getCompetitor((await params).slug);
  if (!c) notFound();
  const sources = [...new Set(Object.values(c.facts).flatMap((f) => (f.source ? [f.source] : [])))];

  return (
    <>
      <article className="mx-auto max-w-4xl px-4 py-16 sm:px-6">
        <nav aria-label="Breadcrumb" className="text-sm text-ink-muted">
          <a href="/compare/" className="hover:text-ink">
            Compare
          </a>{" "}
          / {c.name}
        </nav>
        <h1 className="mt-4 font-book text-4xl font-medium sm:text-5xl">CadabraCraft vs {c.name}</h1>
        <p className="mt-4 text-lg text-ink-muted">
          {c.tagline} A fair comparison for authors choosing a book formatter: facts only, with sources.
        </p>
        <p className="mt-2 text-xs text-ink-muted">Last checked: {c.checkedOn}</p>

        <div className="mt-10">
          <ComparisonTable c={c} />
        </div>

        <div className="mt-12 grid gap-8 sm:grid-cols-2">
          <section>
            <h2 className="font-book text-2xl">Choose {c.name} if</h2>
            <p className="mt-3 leading-relaxed text-ink-muted">{c.chooseThem}</p>
          </section>
          <section>
            <h2 className="font-book text-2xl">Choose CadabraCraft if</h2>
            <p className="mt-3 leading-relaxed text-ink-muted">{c.chooseUs}</p>
          </section>
        </div>

        <div className="mt-12">
          <a href="/download/" className={btnPrimary}>
            Get CadabraCraft
          </a>
        </div>

        <section className="mt-12 text-sm text-ink-muted">
          <h2 className="font-semibold text-ink">Sources</h2>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            {sources.map((s) => (
              <li key={s}>
                <a href={s} rel="noopener noreferrer" className="hover:text-ink">
                  {s}
                </a>
              </li>
            ))}
          </ul>
          <p className="mt-3">
            {c.name} is a trademark of its owner. Details can change; check the vendor for current information.
            CadabraCraft is early software: print PDF needs Typst installed and downloads are not packaged yet.
          </p>
        </section>
      </article>
      <SponsorBand title="Free forever. Help keep it that way." />
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "BreadcrumbList",
          itemListElement: [
            { "@type": "ListItem", position: 1, name: "Compare", item: `${SITE_URL}/compare/` },
            { "@type": "ListItem", position: 2, name: c.name, item: `${SITE_URL}/compare/${c.slug}/` },
          ],
        }}
      />
    </>
  );
}
