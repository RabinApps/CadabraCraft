import { notFound } from "next/navigation";
import { DocToc } from "@/components/docs/DocToc";
import { mdxComponents } from "@/components/docs/mdx";
import { JsonLd } from "@/components/JsonLd";
import { SponsorBand } from "@/components/SponsorBand";
import { LOCALES, localePath } from "@/i18n/config";
import { getMessages } from "@/i18n/messages";
import { getEntry, listEntries } from "@/lib/docs/entries";
import { loadContent } from "@/lib/docs/load";
import { getLocale, type LocaleParams } from "@/lib/params";
import { breadcrumbLd, pageMetadata } from "@/lib/seo";
import { SITE_URL, btnPrimary, btnSecondary } from "@/lib/site";

export const dynamicParams = false;

export function generateStaticParams() {
  return LOCALES.flatMap((locale) => listEntries(locale, "guides").map((g) => ({ locale, slug: g.slug })));
}

export async function generateMetadata({ params }: LocaleParams<{ slug: string }>) {
  const locale = await getLocale(params);
  const g = getEntry(locale, "guides", (await params).slug);
  if (!g) return {};
  return pageMetadata(locale, g.title, g.description, `/guides/${g.slug}/`, { type: "article" });
}

export default async function GuidePage({ params }: LocaleParams<{ slug: string }>) {
  const locale = await getLocale(params);
  const { slug } = await params;
  const m = getMessages(locale);
  const all = listEntries(locale, "guides");
  const g = all.find((e) => e.slug === slug);
  if (!g) notFound();
  const related = all.filter((o) => o.slug !== g.slug);
  const Content = await loadContent(g, "guides");

  return (
    <>
      <article className="mx-auto max-w-6xl px-4 py-14 sm:px-6">
        <nav aria-label={m.guides.breadcrumb} className="text-sm text-ink-muted">
          <a href={localePath(locale, "/guides/")} className="font-semibold text-accent hover:underline">
            {m.nav.guides}
          </a>{" "}
          / {g.title}
        </nav>
        <h1 className="mt-3 max-w-3xl font-book text-4xl font-medium leading-tight sm:text-5xl">{g.title}</h1>
        <p className="mt-3 text-sm text-ink-muted">
          By RabinApps · {m.docs.updated} <time dateTime={g.updated}>{g.updated}</time> · {g.readMinutes} min read
        </p>
        {g.fallback && (
          <p role="note" className="mt-4 max-w-3xl rounded-md bg-accent-soft px-4 py-3 text-sm">
            {m.docs.notTranslated}
          </p>
        )}

        <div className="mt-10 grid gap-10 lg:grid-cols-[220px_1fr] lg:gap-16">
          <DocToc headings={g.headings} m={m} />

          <div className="max-w-3xl">
            <Content components={mdxComponents(locale)} />

            <aside className="mt-10 rounded-lg bg-accent-soft p-6">
              <h2 className="font-book text-2xl font-semibold">Try it in CadabraCraft</h2>
              <p className="mt-2">
                Import your manuscript, pick a template and export an EPUB3. Free, with no account.
              </p>
              <div className="mt-4 flex flex-wrap gap-3">
                <a href={localePath(locale, "/download/")} className={btnPrimary}>
                  Download
                </a>
                <a href={localePath(locale, "/formats/")} className={btnSecondary}>
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
                      <a
                        href={localePath(locale, `/guides/${o.slug}/`)}
                        className="flex justify-between gap-4 py-3 font-semibold hover:text-accent"
                      >
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
        data={breadcrumbLd(locale, [
          [m.nav.guides, "/guides/"],
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
          inLanguage: g.locale,
          author: {
            "@type": "Organization",
            name: "RabinApps",
            url: "https://github.com/RabinApps",
          },
          publisher: { "@type": "Organization", name: "RabinApps" },
          mainEntityOfPage: `${SITE_URL}${localePath(locale, `/guides/${g.slug}/`)}`,
        }}
      />
    </>
  );
}
