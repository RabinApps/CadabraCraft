import { PageHeader } from "@/components/PageHeader";
import { localePath } from "@/i18n/config";
import { getMessages } from "@/i18n/messages";
import { listEntries, type Entry } from "@/lib/docs/entries";
import { getLocale, type LocaleParams } from "@/lib/params";
import { pageMetadata } from "@/lib/seo";

export async function generateMetadata({ params }: LocaleParams) {
  const locale = await getLocale(params);
  const m = getMessages(locale);
  return pageMetadata(locale, m.docs.title, m.docs.lead, "/docs/");
}

function groupEntries(entries: Entry[]): { name: string; items: Entry[] }[] {
  const groups: { name: string; items: Entry[] }[] = [];
  for (const e of entries) {
    const g = groups.find((x) => x.name === e.group);
    if (g) g.items.push(e);
    else groups.push({ name: e.group, items: [e] });
  }
  return groups;
}

export default async function DocsIndex({ params }: LocaleParams) {
  const locale = await getLocale(params);
  const m = getMessages(locale);
  const entries = listEntries(locale, "docs");
  const href = (slug: string) => localePath(locale, `/docs/${slug}/`);
  return (
    <>
      <PageHeader eyebrow={m.docs.title} title={m.docs.heading} lead={m.docs.lead} />
      <section className="mx-auto max-w-6xl px-4 pb-6 sm:px-6">
        <ul className="grid gap-4 md:grid-cols-3">
          {m.docs.quick.map((q) => (
            <li key={q.slug}>
              <a href={href(q.slug)} className="block h-full rounded-xl bg-accent-soft p-6 hover:opacity-90">
                <h2 className="text-lg font-semibold">{q.title}</h2>
                <p className="mt-2 text-sm text-ink-muted">{q.text}</p>
              </a>
            </li>
          ))}
        </ul>
      </section>
      <section className="mx-auto max-w-6xl px-4 pb-16 pt-6 sm:px-6">
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {groupEntries(entries).map((g) => (
            <li key={g.name} className="rounded-xl border border-border bg-surface p-6">
              <h2 className="font-book text-2xl font-semibold">{g.name}</h2>
              <p className="mt-1 text-xs text-ink-muted">
                {g.items.length} {g.items.length === 1 ? m.docs.page : m.docs.pages}
              </p>
              <ul className="mt-4 space-y-2 text-sm">
                {g.items.map((e) => (
                  <li key={e.slug}>
                    <a href={href(e.slug)} className="text-accent hover:underline">
                      {e.title}
                    </a>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}
