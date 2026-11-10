import { notFound } from "next/navigation";
import { DocPager } from "@/components/docs/DocPager";
import { DocToc } from "@/components/docs/DocToc";
import { DocsNav } from "@/components/docs/DocsNav";
import { mdxComponents } from "@/components/docs/mdx";
import { JsonLd } from "@/components/JsonLd";
import { LOCALES } from "@/i18n/config";
import { getMessages } from "@/i18n/messages";
import { getEntry, listEntries } from "@/lib/docs/entries";
import { loadContent } from "@/lib/docs/load";
import { getLocale, type LocaleParams } from "@/lib/params";
import { breadcrumbLd, pageMetadata } from "@/lib/seo";
import { REPO } from "@/lib/site";

export const dynamicParams = false;

export function generateStaticParams() {
  return LOCALES.flatMap((locale) => listEntries(locale, "docs").map((e) => ({ locale, slug: e.slug })));
}

export async function generateMetadata({ params }: LocaleParams<{ slug: string }>) {
  const locale = await getLocale(params);
  const e = getEntry(locale, "docs", (await params).slug);
  if (!e) return {};
  return pageMetadata(locale, e.title, e.description, `/docs/${e.slug}/`, { type: "article" });
}

export default async function DocPage({ params }: LocaleParams<{ slug: string }>) {
  const locale = await getLocale(params);
  const { slug } = await params;
  const m = getMessages(locale);
  const entries = listEntries(locale, "docs");
  const i = entries.findIndex((e) => e.slug === slug);
  if (i < 0) notFound();
  const entry = entries[i];
  if (!entry) notFound();
  const Content = await loadContent(entry, "docs");

  return (
    <>
      <div className="mx-auto grid max-w-7xl gap-10 px-4 py-10 sm:px-6 lg:grid-cols-[240px_minmax(0,1fr)] xl:grid-cols-[240px_minmax(0,1fr)_200px]">
        <DocsNav locale={locale} entries={entries} current={slug} m={m} />
        <article className="min-w-0 max-w-3xl">
          <h1 className="font-book text-4xl font-medium leading-tight sm:text-5xl">{entry.title}</h1>
          <p className="mt-3 text-sm text-ink-muted">
            {m.docs.updated} <time dateTime={entry.updated}>{entry.updated}</time>
          </p>
          {entry.fallback && (
            <p role="note" className="mt-4 rounded-md bg-accent-soft px-4 py-3 text-sm">
              {m.docs.notTranslated}
            </p>
          )}
          <Content components={mdxComponents(locale)} />
          <p className="mt-10 text-sm">
            <a
              href={`${REPO}/edit/main/${entry.file}`}
              rel="noopener noreferrer"
              className="text-accent hover:underline"
            >
              {m.docs.edit}
            </a>
          </p>
          <DocPager locale={locale} prev={entries[i - 1]} next={entries[i + 1]} m={m} />
        </article>
        <DocToc headings={entry.headings} m={m} />
      </div>
      <JsonLd
        data={breadcrumbLd(locale, [
          [m.nav.docs, "/docs/"],
          [entry.title, `/docs/${slug}/`],
        ])}
      />
    </>
  );
}
