import type { Messages } from "@/i18n/messages";
import type { Heading } from "@/lib/docs/headings";

export function DocToc({ headings, m }: { headings: Heading[]; m: Messages }) {
  if (headings.length === 0) return null;
  return (
    <nav aria-label={m.docs.onThisPage} className="text-sm xl:sticky xl:top-24 xl:self-start">
      <p className="mb-3 text-xs font-semibold text-ink-muted">{m.docs.onThisPage}</p>
      <ol className="space-y-2 text-ink-muted">
        {headings.map((h) => (
          <li key={h.id} className={h.level === 3 ? "ps-3" : ""}>
            <a href={`#${h.id}`} className="hover:text-ink">
              {h.text}
            </a>
          </li>
        ))}
      </ol>
    </nav>
  );
}
