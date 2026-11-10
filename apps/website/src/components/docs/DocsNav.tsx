import { localePath, type Locale } from "@/i18n/config";
import type { Messages } from "@/i18n/messages";
import type { Entry } from "@/lib/docs/entries";

/** Sidebar listing every docs page grouped by section; a native <details> on small screens. */
export function DocsNav({
  locale,
  entries,
  current,
  m,
}: {
  locale: Locale;
  entries: Entry[];
  current?: string;
  m: Messages;
}) {
  const groups: { name: string; items: Entry[] }[] = [];
  for (const e of entries) {
    const g = groups.find((x) => x.name === e.group);
    if (g) g.items.push(e);
    else groups.push({ name: e.group, items: [e] });
  }
  const list = (
    <nav aria-label={m.docs.sections} className="space-y-6 text-sm">
      {groups.map((g) => (
        <div key={g.name}>
          <p className="mb-2 text-xs font-semibold text-ink-muted">{g.name}</p>
          <ul className="space-y-1">
            {g.items.map((e) => (
              <li key={e.slug}>
                <a
                  href={localePath(locale, `/docs/${e.slug}/`)}
                  aria-current={e.slug === current ? "page" : undefined}
                  className={`block rounded px-2 py-1.5 hover:bg-sidebar ${
                    e.slug === current ? "bg-accent-soft font-medium text-accent" : "text-ink"
                  }`}
                >
                  {e.title}
                </a>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </nav>
  );
  return (
    <>
      <details className="rounded-md border border-border bg-surface p-3 lg:hidden">
        <summary className="cursor-pointer text-sm font-medium">{m.docs.sections}</summary>
        <div className="mt-4">{list}</div>
      </details>
      <div className="hidden lg:sticky lg:top-24 lg:block lg:max-h-[calc(100vh-7rem)] lg:overflow-y-auto">{list}</div>
    </>
  );
}
