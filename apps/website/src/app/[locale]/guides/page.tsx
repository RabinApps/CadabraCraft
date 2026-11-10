import { listEntries } from "@/lib/docs/entries";
import { localePath } from "@/i18n/config";
import { getLocale, type LocaleParams } from "@/lib/params";
import { PageHeader } from "@/components/PageHeader";
import { SponsorBand } from "@/components/SponsorBand";
import { pageMetadata } from "@/lib/seo";

export async function generateMetadata({ params }: LocaleParams) {
  const locale = await getLocale(params);
  return pageMetadata(
    locale,
    "Guides for self-publishing authors",
    "Practical, plain-language how-tos for importing, formatting and exporting your book with CadabraCraft.",
    "/guides/",
  );
}

export default async function Guides({ params }: LocaleParams) {
  const locale = await getLocale(params);
  const [featured, ...rest] = listEntries(locale, "guides");
  return (
    <>
      <PageHeader
        eyebrow="Guides"
        title="Guides for self-publishing authors"
        lead="Practical, plain-language how-tos for importing, formatting and exporting your book."
      />

      <section className="mx-auto max-w-6xl px-4 pb-14 pt-4 sm:px-6">
        {featured && (
          <a
            href={localePath(locale, `/guides/${featured.slug}/`)}
            className="block rounded-lg border border-border bg-surface p-6 hover:bg-sidebar sm:p-8"
          >
            <p className="w-fit rounded-full bg-accent-soft px-3 py-1 text-xs font-medium text-accent">
              Featured · {featured.tag}
            </p>
            <h2 className="mt-3 font-book text-3xl font-semibold">{featured.title}</h2>
            <p className="mt-2 max-w-2xl text-lg text-ink-muted">{featured.summary}</p>
            <p className="mt-4 text-sm font-semibold text-accent">{featured.readMinutes} min read · Read the guide</p>
          </a>
        )}

        {rest.length > 0 && (
          <div className="mt-12">
            <h2 className="font-book text-3xl">All guides</h2>
            <ul className="mt-4 divide-y divide-border">
              {rest.map((g) => (
                <li key={g.slug}>
                  <a
                    href={localePath(locale, `/guides/${g.slug}/`)}
                    className="flex flex-wrap items-center gap-x-6 gap-y-1 py-5 hover:text-accent"
                  >
                    <span className="w-20 rounded-full bg-accent-soft px-3 py-1 text-center text-xs font-medium text-accent">
                      {g.tag}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block font-book text-xl font-semibold">{g.title}</span>
                      <span className="block text-ink-muted">{g.summary}</span>
                    </span>
                    <span className="text-xs text-ink-muted">{g.readMinutes} min read</span>
                  </a>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>
      <SponsorBand />
    </>
  );
}
