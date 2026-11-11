import type { ChapterDoc, DocNode, Mark } from "../index";
import { seeWords } from "./words";
import type { GlossaryPageSpec, IndexPageSpec } from "./pages";
import type { IndexPlace, IndexTerm } from "./types";

/** A page the index or glossary is written on, as a document: for formats that have no page numbers (Word, Rich Text). */
export interface GeneratedDocPage {
  id: string;
  title: string;
  doc: ChapterDoc;
}

/** Ids of the pages `generatedDocPages` writes. Reserved: a book's own pages cannot use them. */
export const GENERATED_INDEX_ID = "generated-index";
export const GENERATED_GLOSSARY_ID = "generated-glossary";

/**
 * The pages a term is marked on as `{ title, count }`, in reading order, one per page. A page with no title is named by its id (a
 * place on a page the book does not have keeps its id too).
 */
export function placePages(
  places: readonly IndexPlace[],
  titles: ReadonlyMap<string, string>,
): { title: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const p of places) counts.set(p.chapterId, (counts.get(p.chapterId) ?? 0) + 1);
  return [...counts].map(([id, count]) => {
    const title = titles.get(id);
    return { title: title ? title : id, count };
  });
}

const text = (t: string, ...marks: Mark[]): DocNode => ({ type: "text", text: t, marks });
const para = (...content: DocNode[]): DocNode => ({ type: "paragraph", content });
const heading = (level: number, t: string): DocNode => ({
  type: "heading",
  attrs: { level },
  content: [text(t)],
});
const italic: Mark = { type: "italic" };
const bold: Mark = { type: "bold" };

const label = (places: readonly IndexPlace[], titles: ReadonlyMap<string, string>): string =>
  placePages(places, titles)
    .map((p) => `${p.title}${p.count > 1 ? ` (${p.count})` : ""}`)
    .join(", ");

function indexDoc(
  spec: IndexPageSpec,
  titles: ReadonlyMap<string, string>,
  language: string | undefined,
): ChapterDoc {
  const [see, seeAlso] = seeWords(language);
  const xref = (word: string, targets: readonly string[]): DocNode[] =>
    targets.length === 0 ? [] : [text(" "), text(word, italic), text(` ${targets.join("; ")}`)];
  const term = (t: IndexTerm): DocNode => {
    const place = t.places.length ? `: ${label(t.places, titles)}` : "";
    const subs: DocNode[] = t.subs.length
      ? [
          {
            type: "bulletList",
            content: t.subs.map((s) => ({
              type: "listItem",
              content: [para(text(`${s.term}: ${label(s.places, titles)}`))],
            })),
          },
        ]
      : [];
    return {
      type: "listItem",
      content: [
        para(text(`${t.term}${place}`), ...xref(see, t.see), ...xref(seeAlso, t.seeAlso)),
        ...subs,
      ],
    };
  };
  const content: DocNode[] = [heading(1, spec.heading)];
  for (const g of spec.tree.groups) {
    if (spec.letterHeadings) content.push(heading(2, g.letter));
    content.push({ type: "bulletList", content: g.terms.map(term) });
  }
  return { type: "doc", content };
}

function glossaryDoc(spec: GlossaryPageSpec): ChapterDoc {
  const content: DocNode[] = [heading(1, spec.heading)];
  for (const { entry } of spec.items) {
    content.push(para(text(entry.term, bold)));
    for (const p of entry.definition.split(/\n{2,}/)) {
      const t = p.trim();
      if (t !== "") content.push(para(text(t)));
    }
  }
  return { type: "doc", content };
}

/**
 * The index and the glossary as pages to add after a book's own (index first), for the formats that cannot number pages or link: the
 * index lists each term with the titles of the pages it is marked on (a count when a page has it more than once), the glossary a bold
 * term with its definition. A page with nothing to list is left out.
 */
export function generatedDocPages(
  spec: { index?: IndexPageSpec | undefined; glossary?: GlossaryPageSpec | undefined },
  titles: ReadonlyMap<string, string>,
  language: string | undefined,
): GeneratedDocPage[] {
  const pages: GeneratedDocPage[] = [];
  const { index, glossary } = spec;
  if (index && index.tree.groups.length > 0)
    pages.push({
      id: GENERATED_INDEX_ID,
      title: index.heading,
      doc: indexDoc(index, titles, language),
    });
  if (glossary && glossary.items.length > 0)
    pages.push({ id: GENERATED_GLOSSARY_ID, title: glossary.heading, doc: glossaryDoc(glossary) });
  return pages;
}

/**
 * `pages` with the index and glossary in place: a page of kind `index` or `glossary` in the back matter holds the list where the author
 * put it (keeping its own title), and is dropped when there is nothing to list; a list with no such page goes at the end of the book
 * (index first), as `generatedDocPages` writes it. The marks and titles are read from `pages` as they are, so a page's own title is what
 * the index names it by.
 */
export function placeGeneratedDocPages<
  P extends { id?: string | undefined; title: string; doc: ChapterDoc; kind?: string | undefined },
>(
  pages: readonly P[],
  spec: { index?: IndexPageSpec | undefined; glossary?: GlossaryPageSpec | undefined },
  titles: ReadonlyMap<string, string>,
  language: string | undefined,
): (P | (GeneratedDocPage & { section: "back"; kind: "custom" }))[] {
  const built = new Map(generatedDocPages(spec, titles, language).map((g) => [g.id, g]));
  const out: (P | (GeneratedDocPage & { section: "back"; kind: "custom" }))[] = [];
  const slot = (c: P, id: string): boolean => {
    const g = built.get(id);
    if (g) out.push({ ...c, doc: g.doc });
    built.delete(id);
    return true;
  };
  for (const c of pages) {
    if (c.kind === "index" && slot(c, GENERATED_INDEX_ID)) continue;
    if (c.kind === "glossary" && slot(c, GENERATED_GLOSSARY_ID)) continue;
    out.push(c);
  }
  for (const g of built.values()) out.push({ ...g, section: "back", kind: "custom" });
  return out;
}
