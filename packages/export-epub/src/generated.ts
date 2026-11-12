import {
  termKey,
  type GlossaryPageSpec,
  type IndexPageSpec,
  type IndexPlace,
  type IndexTerm,
} from "@cadabracraft/shared";
import { glossaryEntryId, glossaryUseId, type GlossaryLinks } from "./glossaryMark";
import { backToTextLabel } from "./strings";
import { seeAlsoLabel, seeLabel } from "./indexStrings";
import { esc } from "./xhtml";

/** File names (no extension) and ids of the pages the exporter writes itself. Reserved: a book's own pages cannot use them. */
export const INDEX_PAGE = "generated-index";
export const GLOSSARY_PAGE = "generated-glossary";

const INDEX_HEADING_ID = "index-title";
const GLOSSARY_HEADING_ID = "glossary-title";

/** Id of a letter heading on the index page. */
const letterId = (letter: string): string =>
  letter === "#" ? "index-sym" : `index-${letter.toLowerCase()}`;

/** The numbered links of a term's places: each goes to the anchor the chapter wrote at the marked words. */
function placeLinks(label: string, places: readonly IndexPlace[]): string {
  return places
    .map(
      (p, i) =>
        `<a href="${esc(p.chapterId)}.xhtml#idx-${esc(p.id)}" aria-label="${esc(label)} ${i + 1}">${i + 1}</a>`,
    )
    .join(", ");
}

/**
 * The body of the index page: one list per letter, a term's numbered links to the places it was marked, its subentries and its
 * cross-references. A cross-reference to a term that is not in the index is written as plain text so no link is broken.
 */
export function indexBody(spec: IndexPageSpec, language: string): string {
  const anchors = new Map<string, string>();
  spec.tree.groups
    .flatMap((g) => g.terms)
    .forEach((t, i) => anchors.set(termKey(t.term), `index-term-${i + 1}`));
  const xref = (word: string, targets: readonly string[]): string =>
    targets.length === 0
      ? ""
      : ` <em class="xref">${esc(word)}</em> ${targets
          .map((t) => {
            const id = anchors.get(termKey(t));
            return id ? `<a href="#${id}">${esc(t)}</a>` : esc(t);
          })
          .join("; ")}`;
  const term = (t: IndexTerm): string => {
    const subs = t.subs.length
      ? `<ul>${t.subs
          .map((s) => `<li>${esc(s.term)} ${placeLinks(`${t.term}, ${s.term}`, s.places)}</li>`)
          .join("")}</ul>`
      : "";
    const places = t.places.length ? ` ${placeLinks(t.term, t.places)}` : "";
    return `<li id="${anchors.get(termKey(t.term))}">${esc(t.term)}${places}${xref(seeLabel(language), t.see)}${xref(seeAlsoLabel(language), t.seeAlso)}${subs}</li>`;
  };
  const groups = spec.tree.groups
    .map(
      (g) =>
        `${spec.letterHeadings ? `<h2 id="${letterId(g.letter)}">${esc(g.letter)}</h2>` : ""}<ul class="index-group">${g.terms.map(term).join("")}</ul>`,
    )
    .join("");
  return `<section epub:type="index" role="doc-index" aria-labelledby="${INDEX_HEADING_ID}"><h1 id="${INDEX_HEADING_ID}">${esc(spec.heading)}</h1>${groups}</section>`;
}

/** A definition as paragraphs: a blank line starts a new one. */
const paragraphs = (text: string): string =>
  text
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter((p) => p !== "")
    .map((p) => `<p>${esc(p).replace(/\n/g, "<br/>")}</p>`)
    .join("");

/**
 * The body of the glossary page: a definition list. An entry gets a link back to the text only when a chapter wrote a link to it
 * (`links.written`), so every link on the page has a target.
 */
export function glossaryBody(
  spec: GlossaryPageSpec,
  links: GlossaryLinks,
  language: string,
): string {
  const back = esc(backToTextLabel(language));
  const items = spec.items
    .map(({ entry }) => {
      const chapter = links.written.get(entry.id);
      const backlink = chapter
        ? `<a role="doc-backlink" href="${esc(chapter)}.xhtml#${glossaryUseId(entry.id)}" aria-label="${back}">↩</a>`
        : "";
      // A definition is never empty here (an entry without one is not on the page), so there is a last paragraph to end with the link.
      const def = backlink
        ? paragraphs(entry.definition).replace(/<\/p>$/, ` ${backlink}</p>`)
        : paragraphs(entry.definition);
      return `<dt id="${glossaryEntryId(entry.id)}" epub:type="glossterm">${esc(entry.term)}</dt><dd epub:type="glossdef">${def}</dd>`;
    })
    .join("");
  return `<section epub:type="glossary" role="doc-glossary" aria-labelledby="${GLOSSARY_HEADING_ID}"><h1 id="${GLOSSARY_HEADING_ID}">${esc(spec.heading)}</h1><dl>${items}</dl></section>`;
}

/** Style for the generated pages, added to the book's stylesheet. */
export const GENERATED_CSS = `body.generated-index ul,body.generated-glossary dl{margin:0}body.generated-index ul{list-style:none;padding-left:0}body.generated-index li ul{padding-left:1.2em}body.generated-index h2{margin:1em 0 .3em}body.generated-glossary a.glossary-term{text-decoration:none}body.generated-index li a{margin-right:.2em}em.xref{font-style:italic}body.generated-glossary dd{margin:0 0 .6em 0}body.generated-glossary dt{font-weight:bold;margin-top:.8em}`;
