import { getContent } from "@/content";
import { localePath } from "@/i18n/config";
import { getLocale, type LocaleParams } from "@/lib/params";
import { PageHeader } from "@/components/PageHeader";
import { SponsorBand } from "@/components/SponsorBand";
import { pageMetadata } from "@/lib/seo";

export async function generateMetadata({ params }: LocaleParams) {
  const locale = await getLocale(params);
  return pageMetadata(
    locale,
    "Compare book formatting software",
    "Fair, dated, side-by-side comparisons of CadabraCraft, a free, source-available book formatter, with popular alternatives.",
    "/compare/",
  );
}

const method = [
  { title: "Dated", body: "Every comparison shows the date it was last checked." },
  { title: "Sourced", body: "Each fact links to the vendor page it came from." },
  { title: "Honest about gaps", body: "If we could not confirm something, it says Not verified." },
] as const;

export default async function CompareIndex({ params }: LocaleParams) {
  const locale = await getLocale(params);
  const { competitors, factRows, us } = getContent(locale).competitors;
  const lastChecked = competitors.map((c) => c.checkedOn).sort()[0];
  return (
    <>
      <PageHeader
        eyebrow="Compare"
        title="Compare CadabraCraft"
        lead="Looking for a free alternative to paid book formatters, or just choosing your tools? These pages stick to facts the vendors state publicly, each dated and sourced."
        meta={`Oldest check: ${lastChecked}`}
      />

      <section className="mx-auto max-w-6xl px-4 pb-14 pt-4 sm:px-6">
        <ul className="grid gap-4 md:grid-cols-2">
          {competitors.map((c) => (
            <li key={c.slug}>
              <a
                href={localePath(locale, `/compare/${c.slug}/`)}
                className="flex h-full flex-col gap-3 rounded-lg border border-border bg-surface p-6 hover:bg-sidebar"
              >
                <h2 className="font-book text-2xl font-semibold">CadabraCraft vs {c.name}</h2>
                <p className="text-ink-muted">{c.tagline}</p>
                <div>
                  <p className="text-xs font-semibold text-accent">Choose {c.name} if</p>
                  <p className="mt-1 leading-relaxed">{c.chooseThem}</p>
                </div>
                <span className="mt-auto pt-1 text-sm font-semibold text-accent">Read the full comparison</span>
              </a>
            </li>
          ))}
        </ul>
      </section>

      <section className="border-y border-border bg-surface">
        <div className="mx-auto max-w-6xl px-4 py-14 sm:px-6">
          <h2 className="font-book text-3xl">At a glance</h2>
          <p className="mt-3 text-ink-muted">
            Short answers from the sourced pages. Open a comparison for the full table and its sources.
          </p>
          <div className="mt-8 overflow-x-auto rounded-lg border border-border bg-bg">
            <table className="w-full min-w-[820px] text-left text-sm">
              <caption className="sr-only">
                CadabraCraft compared with Vellum, Atticus, Scrivener and Reedsy Studio
              </caption>
              <thead className="bg-sidebar">
                <tr>
                  <th scope="col" className="px-4 py-3 font-semibold">
                    Fact
                  </th>
                  <th scope="col" className="bg-accent-soft px-4 py-3 font-semibold text-accent">
                    CadabraCraft
                  </th>
                  {competitors.map((c) => (
                    <th key={c.slug} scope="col" className="px-4 py-3 font-semibold">
                      {c.name}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {factRows.map((r) => (
                  <tr key={r.key} className="border-t border-border align-top">
                    <th scope="row" className="px-4 py-3 font-semibold">
                      {r.label}
                    </th>
                    <td className="bg-accent-soft px-4 py-3 font-medium text-accent">{us[r.key]}</td>
                    {competitors.map((c) => {
                      const v = c.facts[r.key].value;
                      return (
                        <td key={c.slug} className={`px-4 py-3 ${v === "Not verified" ? "text-ink-muted" : ""}`}>
                          {v}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 py-14 sm:px-6">
        <h2 className="font-book text-3xl">How these pages are written</h2>
        <div className="mt-8 grid gap-8 md:grid-cols-3 md:gap-10">
          {method.map((m) => (
            <div key={m.title}>
              <h3 className="font-semibold">{m.title}</h3>
              <p className="mt-1.5 leading-relaxed text-ink-muted">{m.body}</p>
            </div>
          ))}
        </div>
      </section>
      <SponsorBand title="Free forever. Help keep it that way." />
    </>
  );
}
