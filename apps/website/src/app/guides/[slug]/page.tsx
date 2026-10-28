import { notFound } from "next/navigation";
import { JsonLd } from "@/components/JsonLd";
import { SponsorBand } from "@/components/SponsorBand";
import { getGuide, guides } from "@/data/guides";
import { breadcrumbLd, pageMetadata } from "@/lib/seo";
import { SITE_URL, btnPrimary, btnSecondary } from "@/lib/site";

type Params = { slug: string };

export const dynamicParams = false;

export function generateStaticParams(): Params[] {
  return guides.map((g) => ({ slug: g.slug }));
}

export async function generateMetadata({ params }: { params: Promise<Params> }) {
  const g = getGuide((await params).slug);
  if (!g) return {};
  return pageMetadata(g.title, g.description, `/guides/${g.slug}/`, { type: "article" });
}

export default async function GuidePage({ params }: { params: Promise<Params> }) {
  const g = getGuide((await params).slug);
  if (!g) notFound();
  const related = guides.filter((o) => o.slug !== g.slug);

  return (
    <>
      <article className="mx-auto max-w-6xl px-4 py-14 sm:px-6">
        <nav aria-label="Breadcrumb" className="text-sm text-ink-muted">
          <a href="/guides/" className="font-semibold text-accent hover:underline">
            Guides
          </a>{" "}
          / {g.title}
        </nav>
        <h1 className="mt-3 max-w-3xl font-book text-4xl font-medium leading-tight sm:text-5xl">{g.title}</h1>
        <p className="mt-3 text-sm text-ink-muted">
          By RabinApps · Updated <time dateTime={g.updated}>{g.updated}</time> · {g.readMinutes} min read
        </p>

        <div className="mt-10 grid gap-10 lg:grid-cols-[220px_1fr] lg:gap-16">
          <nav aria-label="On this page" className="text-sm lg:sticky lg:top-24 lg:self-start">
            <p className="mb-3 text-xs font-semibold text-ink-muted">On this page</p>
            <ol className="space-y-2.5 text-ink-muted">
              {g.sections.map((s) => (
                <li key={s.id}>
                  <a href={`#${s.id}`} className="hover:text-ink">
                    {s.heading}
                  </a>
                </li>
              ))}
            </ol>
          </nav>

          <div className="max-w-3xl space-y-5">
            <p className="text-lg leading-relaxed">{g.intro}</p>
            {g.sections.map((s) => (
              <section key={s.id} id={s.id} aria-labelledby={`${s.id}-h`} className="scroll-mt-24 space-y-3 pt-4">
                <h2 id={`${s.id}-h`} className="font-book text-3xl font-semibold">
                  {s.heading}
                </h2>
                {s.paragraphs.map((p) => (
                  <p key={p} className="leading-relaxed">
                    {p}
                  </p>
                ))}
              </section>
            ))}

            <aside className="mt-6 rounded-lg bg-accent-soft p-6">
              <h2 className="font-book text-2xl font-semibold">Try it in CadabraCraft</h2>
              <p className="mt-2">
                Import your manuscript, pick a template and export an EPUB3. Free, with no account.
              </p>
              <div className="mt-4 flex flex-wrap gap-3">
                <a href="/download/" className={btnPrimary}>
                  Download
                </a>
                <a href="/formats/" className={btnSecondary}>
                  See all formats
                </a>
              </div>
            </aside>

            {related.length > 0 && (
              <section aria-labelledby="related-h" className="pt-6">
                <h2 id="related-h" className="font-book text-3xl font-semibold">
                  Related guides
                </h2>
                <ul className="mt-3 divide-y divide-border">
                  {related.map((o) => (
                    <li key={o.slug}>
                      <a href={`/guides/${o.slug}/`} className="flex justify-between gap-4 py-3 font-semibold hover:text-accent">
                        {o.title}
                        <span className="text-xs font-normal text-ink-muted">{o.readMinutes} min read</span>
                      </a>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </div>
        </div>
      </article>
      <SponsorBand />
      <JsonLd
        data={breadcrumbLd([
          ["Guides", "/guides/"],
          [g.title, `/guides/${g.slug}/`],
        ])}
      />
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "Article",
          headline: g.title,
          description: g.description,
          datePublished: g.updated,
          dateModified: g.updated,
          author: { "@type": "Organization", name: "RabinApps", url: "https://github.com/RabinApps" },
          publisher: { "@type": "Organization", name: "RabinApps" },
          mainEntityOfPage: `${SITE_URL}/guides/${g.slug}/`,
        }}
      />
    </>
  );
}
