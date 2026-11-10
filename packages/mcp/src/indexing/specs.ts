// Builds the index and glossary pages' specs for the exporters from the manifest's settings and the marks in the pages, the
// same way the app does. A page that is off in the settings, or has nothing to list, is not passed on.
import type { Manifest } from "@cadabracraft/format";
import {
  buildGlossary,
  buildIndex,
  collectGlossaryUses,
  collectIndexMarks,
  type ChapterDoc,
  type GlossaryPageSpec,
  type IndexPageSpec,
} from "@cadabracraft/shared";
import type { JsonMark, JsonNode } from "./marks";

interface Source {
  id: string;
  doc: ChapterDoc;
}

export interface ExportSpecs<C extends Source> {
  /** The pages to export: the book's own, plus (with the glossary in the index) an index place at each use of a glossary term. */
  chapters: C[];
  index?: IndexPageSpec;
  glossary?: GlossaryPageSpec;
}

/** The options the exporters take for the two pages. */
export const specOptions = (s: {
  index?: IndexPageSpec;
  glossary?: GlossaryPageSpec;
}): { index?: IndexPageSpec; glossary?: GlossaryPageSpec } => ({
  ...(s.index ? { index: s.index } : {}),
  ...(s.glossary ? { glossary: s.glossary } : {}),
});

/** How many terms the index lists and entries the glossary lists (0 when the page is not written). */
export const specCounts = (s: {
  index?: IndexPageSpec;
  glossary?: GlossaryPageSpec;
}): { indexTerms: number; glossaryEntries: number } => ({
  indexTerms: s.index ? s.index.tree.groups.reduce((n, g) => n + g.terms.length, 0) : 0,
  glossaryEntries: s.glossary ? s.glossary.items.length : 0,
});

/**
 * Gives every use of a glossary term in `terms` (entry id to the term it is listed under) an index place, so the index can list
 * it and the EPUB and PDF can link and number it. Words split over differently formatted text nodes stay one place.
 */
function withGlossaryPlaces<C extends Source>(
  chapters: C[],
  terms: ReadonlyMap<string, string>,
): C[] {
  const taken = new Set(collectIndexMarks(chapters).map((r) => r.place.id));
  let n = 0;
  const fresh = (): string => {
    do n++;
    while (taken.has(`gx-${n}`));
    return `gx-${n}`;
  };
  const walk = (node: JsonNode): JsonNode => {
    if (!node.content) return node;
    let open = new Map<string, string>();
    const content = node.content.map((c) => {
      if (c.type !== "text") {
        open = new Map();
        return walk(c);
      }
      const here = new Map<string, string>();
      const extra: JsonMark[] = [];
      for (const m of c.marks ?? []) {
        const id = m.type === "glossaryTerm" ? (m.attrs!.id as string) : "";
        const term = terms.get(id);
        if (term === undefined) continue;
        const place = open.get(id) ?? fresh();
        here.set(id, place);
        extra.push({ type: "indexEntry", attrs: { id: place, term } });
      }
      open = here;
      return extra.length ? { ...c, marks: [...c.marks!, ...extra] } : c;
    });
    return { ...node, content };
  };
  return chapters.map((c) => ({ ...c, doc: walk(c.doc as JsonNode) as ChapterDoc }));
}

/**
 * The index and glossary for an export of `chapters` in `language`. The index is built when `manifest.index.enabled`: places from
 * the `indexEntry` marks, sorted for the language, minus the hidden terms (and singles when asked). With `glossary.inIndex` every
 * used glossary entry that has a definition is listed too. The glossary is built when `manifest.glossary.enabled`, without the
 * entries that have no definition.
 */
export function exportSpecs<C extends Source>(
  manifest: Manifest,
  chapters: C[],
  language: string,
): ExportSpecs<C> {
  const { index: ix, glossary: gl } = manifest;
  const out: ExportSpecs<C> = { chapters };
  if (gl?.enabled) {
    const built = buildGlossary(gl.entries, collectGlossaryUses(chapters), {
      locale: language,
      order: gl.order,
    });
    if (built.items.length)
      out.glossary = { heading: gl.heading, items: built.items, markFirstUse: gl.markFirstUse };
  }
  if (ix?.enabled) {
    if (gl?.inIndex) {
      const used = collectGlossaryUses(chapters);
      const terms = new Map(
        gl.entries
          .filter((e) => e.definition.trim() !== "" && used.has(e.id))
          .map((e) => [e.id, e.term]),
      );
      if (terms.size) out.chapters = withGlossaryPlaces(chapters, terms);
    }
    const tree = buildIndex(collectIndexMarks(out.chapters), {
      locale: language,
      hidden: ix.hidden,
      hideSingles: ix.hideSingles,
    });
    if (tree.groups.length)
      out.index = {
        heading: ix.heading,
        letterHeadings: ix.letterHeadings,
        ranges: ix.ranges,
        columns: ix.columns,
        tree,
      };
  }
  return out;
}
