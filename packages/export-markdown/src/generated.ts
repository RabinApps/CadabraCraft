import {
  placePages,
  seeWords,
  type GlossaryPageSpec,
  type IndexPageSpec,
  type IndexPlace,
  type IndexTerm,
} from "@cadabracraft/shared";
import { escapeText } from "./escape";

const text = (s: string): string => escapeText(s, false, {});
/** A title or term at the start of a line: a leading "1." or "-" must not become a list. */
const lead = (s: string): string => escapeText(s, true, {});

/** The places of a term as the titles of the pages they are on, a page named once with how often when more than once. */
function where(places: readonly IndexPlace[], titles: ReadonlyMap<string, string>): string {
  return placePages(places, titles)
    .map((p) => `${text(p.title)}${p.count > 1 ? ` (${p.count})` : ""}`)
    .join(", ");
}

/**
 * The index as Markdown. A Markdown book has no pages, so each term lists the pages (chapters) it is marked on, with the count when a
 * page has it more than once. Cross-references use the words of the book's language.
 */
export function indexMarkdown(
  spec: IndexPageSpec,
  titles: ReadonlyMap<string, string>,
  language: string | undefined,
): string {
  const [see, seeAlso] = seeWords(language);
  const xref = (word: string, targets: readonly string[]): string =>
    targets.length === 0 ? "" : ` *${word}* ${targets.map(text).join("; ")}`;
  const term = (t: IndexTerm): string[] => {
    const place = t.places.length ? `: ${where(t.places, titles)}` : "";
    return [
      `- ${lead(t.term)}${place}${xref(see, t.see)}${xref(seeAlso, t.seeAlso)}`,
      ...t.subs.map((s) => `  - ${lead(s.term)}: ${where(s.places, titles)}`),
    ];
  };
  const groups = spec.tree.groups.map((g) =>
    [spec.letterHeadings ? `## ${text(g.letter)}\n` : "", ...g.terms.flatMap(term)]
      .filter((l) => l !== "")
      .join("\n"),
  );
  return `# ${lead(spec.heading)}\n\n${groups.join("\n\n")}\n`;
}

/** The glossary as Markdown: each term in bold on a line of its own, then its definition's paragraphs. */
export function glossaryMarkdown(spec: GlossaryPageSpec): string {
  const entries = spec.items.map(({ entry }) => {
    const paragraphs = entry.definition
      .split(/\n{2,}/)
      .map((p) => p.trim())
      .filter((p) => p !== "")
      .map((p) => lead(p).replace(/\n/g, "  \n"));
    return [`**${text(entry.term)}**`, ...paragraphs].join("\n\n");
  });
  return `# ${lead(spec.heading)}\n\n${entries.join("\n\n")}\n`;
}
