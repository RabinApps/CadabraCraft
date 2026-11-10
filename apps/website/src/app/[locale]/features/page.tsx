import { getContent } from "@/content";
import { localePath } from "@/i18n/config";
import { getLocale, type LocaleParams } from "@/lib/params";
import { FeatureRow } from "@/components/FeatureRow";
import { PageHeader } from "@/components/PageHeader";
import { SponsorBand } from "@/components/SponsorBand";
import { pageMetadata } from "@/lib/seo";
import { RELEASES, REPO, btnPrimary, btnSecondary } from "@/lib/site";

export async function generateMetadata({ params }: LocaleParams) {
  const locale = await getLocale(params);
  return pageMetadata(
    locale,
    "Book writing and formatting features",
    "A calm editor, Word and Markdown import, EPUB3 and print PDF export, audiobooks and language editions, all local-first. Free and source-available.",
    "/features/",
  );
}

export default async function Features({ params }: LocaleParams) {
  const locale = await getLocale(params);
  const { featureGroups, formatChips, smallThings } = getContent(locale).content;
  return (
    <>
      <PageHeader
        center
        eyebrow="Features"
        title="Everything you need to finish a book"
        lead="CadabraCraft is a desktop app for writing and formatting books, with your manuscript kept in plain files on your computer."
      >
        <a href={localePath(locale, "/download/")} className={btnPrimary}>
          Download
        </a>
        <a href={REPO} className={btnSecondary}>
          View on GitHub
        </a>
      </PageHeader>

      <ul aria-label="Formats" className="mx-auto flex max-w-6xl flex-wrap justify-center gap-2 px-4 pb-10 sm:px-6">
        {formatChips.map((c) => (
          <li key={c} className="rounded-full border border-border bg-surface px-3.5 py-1.5 text-xs font-semibold">
            {c}
          </li>
        ))}
      </ul>

      <div className="mx-auto flex max-w-6xl flex-col gap-16 px-4 py-10 sm:px-6 lg:gap-20">
        {featureGroups.map((g, i) => (
          <FeatureRow key={g.id} group={g} flip={i % 2 === 1} />
        ))}
      </div>

      <section className="border-y border-border bg-surface">
        <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
          <h2 className="font-book text-3xl">And the small things</h2>
          <div className="mt-8 grid gap-8 sm:grid-cols-2 lg:grid-cols-3 lg:gap-10">
            {smallThings.map((s) => (
              <div key={s.title}>
                <h3 className="font-semibold">{s.title}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-ink-muted">{s.body}</p>
              </div>
            ))}
          </div>
          <p className="mt-10 text-sm text-ink-muted">
            Not released yet. Follow progress on{" "}
            <a href={RELEASES} className="text-accent hover:underline">
              GitHub Releases
            </a>
            .
          </p>
        </div>
      </section>
      <SponsorBand />
    </>
  );
}
