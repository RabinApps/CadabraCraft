import { getContent } from "@/content";
import { localePath } from "@/i18n/config";
import { getLocale, type LocaleParams } from "@/lib/params";
import { TrustPoints } from "@/components/TrustPoints";
import { Screenshot } from "@/components/Screenshot";
import { Faq } from "@/components/Faq";
import { SponsorBand } from "@/components/SponsorBand";
import { btnPrimary, btnSecondary, REPO } from "@/lib/site";

export default async function Home({ params }: LocaleParams) {
  const locale = await getLocale(params);
  const { benefits, faq, formatChips, steps } = getContent(locale).content;
  const { competitors } = getContent(locale).competitors;
  return (
    <>
      <section className="mx-auto max-w-6xl px-4 pb-16 pt-14 text-center sm:px-6 sm:pt-20">
        <h1 className="mx-auto max-w-3xl font-book text-4xl font-medium leading-tight sm:text-6xl">
          Write your book. Format it beautifully.
        </h1>
        <p className="mx-auto mt-5 max-w-2xl text-lg text-ink-muted">
          A desktop app for self-publishing authors. Write in a calm editor, pick a template, and export EPUB3,
          print-ready PDF, Word, Markdown or an audiobook. Everything lives in plain files on your computer.
        </p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <a href={localePath(locale, "/download/")} className={btnPrimary}>
            Download
          </a>
          <a href={REPO} className={btnSecondary}>
            View on GitHub
          </a>
        </div>
        <TrustPoints locale={locale} />
        <div className="mx-auto mt-14 max-w-4xl text-left">
          <Screenshot
            name="editor"
            eager
            alt="The CadabraCraft editor showing a chapter of a novel as a book page, with the chapter list on the left and book details on the right."
            className="rounded-xl border border-border shadow-2xl shadow-black/10"
          />
        </div>
      </section>

      <section className="border-y border-border bg-surface">
        <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
          <h2 className="font-book text-3xl">Made for the long haul</h2>
          <div className="mt-10 grid gap-10 sm:grid-cols-3">
            {benefits.map((b) => (
              <div key={b.title}>
                <h3 className="text-lg font-semibold">{b.title}</h3>
                <p className="mt-2 leading-relaxed text-ink-muted">{b.body}</p>
              </div>
            ))}
          </div>
          <a
            href={localePath(locale, "/features/")}
            className="mt-8 inline-block text-sm font-medium text-accent hover:underline"
          >
            See all features
          </a>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
        <h2 className="font-book text-3xl">From manuscript to book in three steps</h2>
        <ol className="mt-10 grid gap-8 md:grid-cols-3 md:gap-10">
          {steps.map((s, i) => (
            <li key={s.title}>
              <span
                aria-hidden
                className="flex size-8 items-center justify-center rounded-full bg-accent-soft text-sm font-semibold text-accent"
              >
                {i + 1}
              </span>
              <h3 className="mt-3 text-lg font-semibold">{s.title}</h3>
              <p className="mt-1.5 leading-relaxed text-ink-muted">{s.body}</p>
            </li>
          ))}
        </ol>
        <p className="mt-8 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-ink-muted">
          {formatChips.join(" · ")}
          <a href={localePath(locale, "/formats/")} className="font-medium text-accent hover:underline">
            See all formats
          </a>
        </p>
      </section>

      <section className="border-y border-border bg-sidebar/40">
        <div className="mx-auto max-w-6xl px-4 py-16 text-center sm:px-6">
          <h2 className="font-book text-3xl">How does it compare?</h2>
          <p className="mt-3 text-ink-muted">Honest, dated, side-by-side comparisons.</p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            {competitors.map((c) => (
              <a key={c.slug} href={localePath(locale, `/compare/${c.slug}/`)} className={btnSecondary}>
                vs {c.name}
              </a>
            ))}
          </div>
        </div>
      </section>

      <Faq items={faq} />
      <SponsorBand />
    </>
  );
}
