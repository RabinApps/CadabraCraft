import { getContent } from "@/content";
import { localePath } from "@/i18n/config";
import { getLocale, type LocaleParams } from "@/lib/params";
import { PageHeader } from "@/components/PageHeader";
import { SponsorBand } from "@/components/SponsorBand";
import { type ChangeKind } from "@/content/en/changelog";
import { pageMetadata } from "@/lib/seo";
import { RELEASES } from "@/lib/site";

export async function generateMetadata({ params }: LocaleParams) {
  const locale = await getLocale(params);
  return pageMetadata(
    locale,
    "Changelog",
    "What is new in CadabraCraft. Release notes come from GitHub Releases.",
    "/changelog/",
  );
}

const tone: Record<ChangeKind, string> = {
  New: "bg-accent-soft text-accent",
  Improved: "bg-sidebar text-success",
  Info: "bg-sidebar text-ink-muted",
};

export default async function Changelog({ params }: LocaleParams) {
  const locale = await getLocale(params);
  const { changelog } = getContent(locale).changelog;
  return (
    <>
      <PageHeader
        eyebrow="Changelog"
        title="What changed"
        lead={
          <>
            Release notes come from{" "}
            <a href={RELEASES} className="text-accent hover:underline">
              GitHub Releases
            </a>
            . Each entry lists what is new and improved.
          </>
        }
      />
      <section className="mx-auto max-w-6xl divide-y divide-border px-4 pb-14 sm:px-6">
        {changelog.map((e) => (
          <article key={e.version} className="grid gap-4 py-8 md:grid-cols-[200px_1fr] md:gap-12">
            <header>
              <h2 className="font-book text-2xl font-semibold">{e.version}</h2>
              <p className="text-sm text-ink-muted">{e.label}</p>
            </header>
            <ul className="space-y-3">
              {e.changes.map((c) => (
                <li key={c.text} className="flex items-start gap-3">
                  <span
                    className={`mt-0.5 w-20 shrink-0 rounded-full py-0.5 text-center text-[11px] font-semibold ${tone[c.kind]}`}
                  >
                    {c.kind}
                  </span>
                  <span className="leading-relaxed">{c.text}</span>
                </li>
              ))}
            </ul>
          </article>
        ))}
      </section>
      <SponsorBand />
    </>
  );
}
