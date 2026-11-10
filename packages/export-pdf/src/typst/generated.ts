import type { GlossaryPageSpec, IndexPageSpec, IndexPlace, IndexTerm } from "@cadabracraft/shared";
import { typstString } from "../escape";
import { PdfExportError } from "../errors";
import { seeWords } from "../strings";
import type { PdfBook, PdfChapter, PdfOptions } from "../types";
import type { Ctx } from "./ctx";

/** Ids of the pages the exporter writes itself. Reserved: a book's own pages cannot use them. */
export const INDEX_PAGE = "generated-index";
export const GLOSSARY_PAGE = "generated-glossary";

const arr = (items: readonly string[]): string =>
  items.length === 0 ? "()" : `(${items.join(", ")},)`;
const strs = (items: readonly string[]): string => arr(items.map(typstString));
const ids = (places: readonly IndexPlace[]): string => strs(places.map((p) => p.id));

const termSource = (t: IndexTerm): string =>
  `(term: ${typstString(t.term)}, places: ${ids(t.places)}, subs: ${arr(
    t.subs.map((s) => `(term: ${typstString(s.term)}, places: ${ids(s.places)})`),
  )}, see: ${strs(t.see)}, seeAlso: ${strs(t.seeAlso)})`;

/** The index as a Typst array of `(letter, terms)`; a place is named by the id its `index-place` mark carries. */
function indexEntries(spec: IndexPageSpec): string {
  return arr(
    spec.tree.groups.map(
      (g) => `(letter: ${typstString(g.letter)}, terms: ${arr(g.terms.map(termSource))})`,
    ),
  );
}

/**
 * The Typst helpers of the two pages, written only when the book has them. `index-list` runs in one `context`: it looks up the page of
 * each place through the `<index-place>` marks and prints the number the footer prints there (roman before the `<numbering-arabic>` mark,
 * arabic after), each one a link to its place. A run of three or more pages becomes a range when asked for (a pair stays two pages).
 */
export function generatedDefs(options: PdfOptions, hasFront: boolean): string {
  const index =
    options.index && options.index.tree.groups.length > 0
      ? `#let index-list(entries, ranges, letters, see-word, see-also-word, cols) = context {
  let arabic = query(<numbering-arabic>).map(m => m.location().page())
  let first-arabic = ${hasFront ? "if arabic.len() > 0 { arabic.first() } else { 1000000 }" : "0"}
  let hidden = no-folio-pages()
  let locs = (:)
  for m in query(<index-place>) { if m.value.id not in locs { locs.insert(m.value.id, m.location()) } }
  let fmt(loc) = numbering(if loc.page() < first-arabic { "i" } else { "1" }, ..counter(page).at(loc))
  let pages(places) = {
    let found = places.filter(i => i in locs).map(i => locs.at(i)).filter(l => not (l.page() in hidden)).sorted(key: l => l.page())
    let uniq = found.fold((), (acc, l) => if acc.len() > 0 and acc.last().page() == l.page() { acc } else { acc + (l,) })
    let runs = uniq.fold((), (acc, l) => if ranges and acc.len() > 0 and acc.last().last().page() + 1 == l.page() { acc.slice(0, -1) + ((acc.last() + (l,)),) } else { acc + ((l,),) })
    runs.map(r => if r.len() >= 3 { [#link(r.first(), fmt(r.first()))–#link(r.last(), fmt(r.last()))] } else { r.map(l => link(l, fmt(l))).join(", ") }).join(", ")
  }
  let line(body, ind) = block(above: 0.3em, below: 0.3em, width: 100%, par(first-line-indent: 0pt, justify: false, hanging-indent: 1.2em, { h(ind); body }))
  let xref(word, targets) = if targets.len() > 0 [ #emph(word) #targets.join("; ")] else []
  let list = {
    for g in entries {
      if letters { block(above: 0.9em, below: 0.3em, sticky: true, text(weight: "bold")[#g.letter]) }
      for t in g.terms {
        let p = pages(t.places)
        line({ t.term; if p != none [, #p]; xref(see-word, t.see); xref(see-also-word, t.seeAlso) }, 0em)
        for s in t.subs {
          let sp = pages(s.places)
          line({ s.term; if sp != none [, #sp] }, 1.2em)
        }
      }
    }
  }
  if cols > 1 { columns(cols, gutter: 1.5em, list) } else { list }
}
`
      : "";
  const glossary =
    options.glossary && options.glossary.items.length > 0
      ? `#let glossary-entry(term, definition) = block(above: 0.8em, below: 0.8em, width: 100%, {
  par(first-line-indent: 0pt, justify: false, text(weight: "bold", term))
  for p in definition.split("\\n\\n") { par(first-line-indent: 0pt, justify: false, p.trim()) }
})
`
      : "";
  return index + glossary;
}

/** A page of just a title, which the generated list goes under. */
const titleDoc = (title: string): PdfChapter["doc"] => ({
  type: "doc",
  content: [{ type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: title }] }],
});

/**
 * The index and glossary pages for the end of the book (index first), and their source under the title (stored in `ctx`). A page with
 * nothing to list is left out. Throws when a page of the book already uses one of the reserved ids.
 */
export function generatedPages(
  book: PdfBook,
  chapters: readonly PdfChapter[],
  options: PdfOptions,
  ctx: Ctx,
): PdfChapter[] {
  const clash = chapters.find((c) => c.id === INDEX_PAGE || c.id === GLOSSARY_PAGE);
  if (clash) throw new PdfExportError(`Page id "${clash.id}" is reserved for a generated page`);
  const pages: PdfChapter[] = [];
  const tails = new Map<string, string>();
  const add = (id: string, title: string, tail: string) => {
    pages.push({ id, title, doc: titleDoc(title), section: "back", kind: "custom" });
    tails.set(id, tail);
  };
  const index = options.index;
  if (index && index.tree.groups.length > 0) {
    const [see, seeAlso] = seeWords(book.language);
    add(
      INDEX_PAGE,
      index.heading,
      `#index-list(${indexEntries(index)}, ${index.ranges}, ${index.letterHeadings}, ${typstString(see)}, ${typstString(seeAlso)}, ${index.columns})`,
    );
  }
  const glossary: GlossaryPageSpec | undefined = options.glossary;
  if (glossary && glossary.items.length > 0)
    add(
      GLOSSARY_PAGE,
      glossary.heading,
      glossary.items
        .map(
          ({ entry }) =>
            `#glossary-entry(${typstString(entry.term)}, ${typstString(entry.definition)})`,
        )
        .join("\n"),
    );
  if (tails.size > 0) ctx.generatedTails = tails;
  return pages;
}
