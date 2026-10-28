import { Faq } from "@/components/Faq";
import { PageHeader } from "@/components/PageHeader";
import { SponsorBand } from "@/components/SponsorBand";
import { formatFaq, formats } from "@/data/content";
import { pageMetadata } from "@/lib/seo";
import { btnPrimary, btnSecondary } from "@/lib/site";

export const metadata = pageMetadata(
  "EPUB, PDF, Word and Markdown for your book",
  "Import Word, Markdown and HTML, write in one calm editor, and export EPUB3, print-ready PDF, Word, Markdown or an audiobook. Free and local-first.",
  "/formats/",
);

const flow = [
  { name: "Import", detail: "Word, Markdown, HTML" },
  { name: "Write", detail: "One editor, chapters, editions" },
  { name: "Export", detail: "EPUB3, PDF, Word, Markdown, audio" },
] as const;

export default function Formats() {
  return (
    <>
      <PageHeader
        center
        eyebrow="Formats"
        title="Import anything. Export everything a book needs."
        lead="Start from Word or Markdown, write in one calm editor, and export EPUB3, print PDF, Word, Markdown or an audiobook."
      >
        <a href="/download/" className={btnPrimary}>
          Download
        </a>
        <a href="/features/" className={btnSecondary}>
          See all features
        </a>
      </PageHeader>

      <ol className="mx-auto flex max-w-6xl flex-col items-stretch gap-3 px-4 pb-12 pt-2 sm:px-6 md:flex-row md:justify-center">
        {flow.map((s, i) => (
          <li key={s.name} className="flex items-center gap-3 md:contents">
            {i > 0 && (
              <span aria-hidden className="hidden self-center text-ink-muted md:inline">
                →
              </span>
            )}
            <div className="flex-1 rounded-lg border border-border bg-surface px-6 py-4 md:max-w-xs">
              <p className="font-book text-xl font-semibold">{s.name}</p>
              <p className="text-sm text-ink-muted">{s.detail}</p>
            </div>
          </li>
        ))}
      </ol>

      <section className="border-y border-border bg-surface">
        <div className="mx-auto max-w-6xl divide-y divide-border px-4 py-6 sm:px-6">
          {formats.map((f) => (
            <article key={f.name} aria-labelledby={`fmt-${f.name}`} className="grid gap-4 py-8 md:grid-cols-[280px_1fr] md:gap-12">
              <div>
                <h2 id={`fmt-${f.name}`} className="font-book text-3xl font-semibold">
                  {f.name}
                </h2>
                <p className="mt-1 text-xs font-semibold text-accent">{f.use}</p>
              </div>
              <div className="space-y-3">
                <p className="text-lg leading-relaxed">{f.lead}</p>
                <ul className="list-disc space-y-1.5 pl-5 text-ink-muted marker:text-accent">
                  {f.points.map((p) => (
                    <li key={p}>{p}</li>
                  ))}
                </ul>
              </div>
            </article>
          ))}
        </div>
      </section>

      <Faq items={formatFaq} title="Format questions" />
      <SponsorBand />
    </>
  );
}
