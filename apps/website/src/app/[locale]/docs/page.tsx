import { DocsNav } from "@/components/docs/DocsNav";
import { PageHeader } from "@/components/PageHeader";
import { localePath } from "@/i18n/config";
import { getMessages } from "@/i18n/messages";
import { listEntries } from "@/lib/docs/entries";
import { getLocale, type LocaleParams } from "@/lib/params";
import { pageMetadata } from "@/lib/seo";

export async function generateMetadata({ params }: LocaleParams) {
  const locale = await getLocale(params);
  const m = getMessages(locale);
  return pageMetadata(locale, m.docs.title, m.docs.lead, "/docs/");
}

export default async function DocsIndex({ params }: LocaleParams) {
  const locale = await getLocale(params);
  const m = getMessages(locale);
  const entries = listEntries(locale, "docs");
  return (
    <>
      <PageHeader eyebrow={m.nav.docs} title={m.docs.title} lead={m.docs.lead} />
      <div className="mx-auto grid max-w-6xl gap-10 px-4 pb-16 sm:px-6 lg:grid-cols-[240px_1fr] lg:gap-16">
        <DocsNav locale={locale} entries={entries} m={m} />
        <ul className="grid gap-4 sm:grid-cols-2">
          {entries.map((e) => (
            <li key={e.slug}>
              <a
                href={localePath(locale, `/docs/${e.slug}/`)}
                className="block h-full rounded-lg border border-border bg-surface p-5 hover:bg-sidebar"
              >
                <p className="text-xs font-semibold text-accent">{e.group}</p>
                <h2 className="mt-1 font-book text-xl font-semibold">{e.title}</h2>
                <p className="mt-2 text-sm text-ink-muted">{e.description}</p>
              </a>
            </li>
          ))}
        </ul>
      </div>
    </>
  );
}
