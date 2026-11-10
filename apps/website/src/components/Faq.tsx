import { JsonLd } from "./JsonLd";

type Item = { readonly q: string; readonly a: string };

export function Faq({ items, title = "Questions" }: { items: readonly Item[]; title?: string }) {
  return (
    <section className="border-y border-border bg-surface">
      <div className="mx-auto max-w-3xl px-4 py-16 sm:px-6">
        <h2 className="font-book text-3xl">{title}</h2>
        <dl className="mt-8 space-y-6">
          {items.map((f) => (
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
          mainEntity: items.map((f) => ({
            "@type": "Question",
            name: f.q,
            acceptedAnswer: { "@type": "Answer", text: f.a },
          })),
        }}
      />
    </section>
  );
}
