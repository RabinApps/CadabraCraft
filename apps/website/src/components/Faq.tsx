import { faq } from "@/data/content";
import { JsonLd } from "./JsonLd";

export function Faq() {
  return (
    <section className="border-y border-border bg-surface">
      <div className="mx-auto max-w-3xl px-4 py-16 sm:px-6">
        <h2 className="font-book text-3xl">Questions</h2>
        <dl className="mt-8 space-y-6">
          {faq.map((f) => (
            <div key={f.q}>
              <dt className="font-semibold">{f.q}</dt>
              <dd className="mt-1 text-ink-muted">{f.a}</dd>
            </div>
          ))}
        </dl>
      </div>
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "FAQPage",
          mainEntity: faq.map((f) => ({
            "@type": "Question",
            name: f.q,
            acceptedAnswer: { "@type": "Answer", text: f.a },
          })),
        }}
      />
    </section>
  );
}
