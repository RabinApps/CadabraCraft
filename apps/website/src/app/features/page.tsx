import { SponsorBand } from "@/components/SponsorBand";
import { features } from "@/data/content";
import { pageMetadata } from "@/lib/seo";

export const metadata = pageMetadata(
  "Features: book writing and formatting software",
  "Local-first editor, EPUB3 and print PDF export, templates, Word and Markdown import. Free and open source.",
  "/features/",
);

export default function Features() {
  return (
    <>
      <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
        <h1 className="font-book text-4xl font-medium sm:text-5xl">Everything you need to finish a book</h1>
        <p className="mt-4 max-w-2xl text-lg text-ink-muted">
          CadabraCraft is a desktop app for writing and formatting books, with your manuscript kept in plain files on
          your computer.
        </p>
        <div className="mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {features.map((f) => (
            <div key={f.title} className="rounded-lg border border-border bg-surface p-6">
              <h2 className="text-base font-semibold">{f.title}</h2>
              <p className="mt-2 text-sm leading-relaxed text-ink-muted">{f.body}</p>
            </div>
          ))}
        </div>
      </section>
      <SponsorBand />
    </>
  );
}
