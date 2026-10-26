import { EditorMockup } from "@/components/EditorMockup";
import { Faq } from "@/components/Faq";
import { SponsorBand } from "@/components/SponsorBand";
import { benefits } from "@/data/content";
import { competitors } from "@/data/competitors";
import { btnPrimary, btnSecondary, REPO } from "@/lib/site";

export default function Home() {
  return (
    <>
      <section className="mx-auto max-w-6xl px-4 pb-16 pt-16 text-center sm:px-6 sm:pt-24">
        <p className="mb-4 inline-block rounded-full bg-accent-soft px-3 py-1 text-xs font-medium text-accent">
          Free and open source · No account · Your files stay yours
        </p>
        <h1 className="mx-auto max-w-3xl font-book text-4xl font-medium leading-tight sm:text-6xl">
          Write your book. Format it beautifully.
        </h1>
        <p className="mx-auto mt-5 max-w-2xl text-lg text-ink-muted">
          A desktop app for self-publishing authors. Write in a calm editor, pick a template, and export a validated
          EPUB3 and print-ready PDF. Everything lives in plain files on your computer.
        </p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <a href={REPO} className={btnPrimary}>
            View on GitHub
          </a>
          <a href="/support/" className={btnSecondary}>
            Support the project
          </a>
        </div>
        <p className="mt-3 text-xs text-ink-muted">Early development. Downloads will appear on GitHub Releases.</p>
        <div className="mx-auto mt-14 max-w-4xl text-left">
          <EditorMockup />
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
          <a href="/features/" className="mt-8 inline-block text-sm font-medium text-accent hover:underline">
            See all features
          </a>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 py-16 text-center sm:px-6">
        <h2 className="font-book text-3xl">How does it compare?</h2>
        <p className="mt-3 text-ink-muted">Honest, dated, side-by-side comparisons.</p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          {competitors.map((c) => (
            <a key={c.slug} href={`/compare/${c.slug}/`} className={btnSecondary}>
              vs {c.name}
            </a>
          ))}
        </div>
      </section>

      <Faq />
      <SponsorBand />
    </>
  );
}
