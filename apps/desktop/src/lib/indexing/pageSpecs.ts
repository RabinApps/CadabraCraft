import {
  buildGlossary,
  buildIndex,
  collectGlossaryUses,
  collectIndexMarks,
  type ChapterDoc,
  type DocNode,
  type GlossaryEntry,
  type GlossaryPageSpec,
  type IndexPageSpec,
  type Mark,
} from "@cadabracraft/shared";
import type { Manifest } from "@cadabracraft/format";
import { indexMark } from "./termOps";

/** What an export passes on: the pages (with the glossary terms the index lists marked as places) and the two generated pages. */
export interface ExportIndexing<P extends { id: string; doc: ChapterDoc }> {
  pages: P[];
  index?: IndexPageSpec;
  glossary?: GlossaryPageSpec;
}

/**
 * Lists each used glossary term in the index too: every use gets an `indexEntry` mark of its own (in memory only, the page files
 * are not touched), so the index finds a place and the exporters write the anchor for it like for any other place.
 */
export function withGlossaryInIndex(
  doc: ChapterDoc,
  entries: ReadonlyMap<string, GlossaryEntry>,
  prefix: string,
): ChapterDoc {
  let n = 0;
  const walk = (node: DocNode): DocNode => {
    if (!("content" in node) || !node.content) return node;
    let open = new Map<string, Mark>();
    const content = node.content.map((c): DocNode => {
      if (c.type !== "text") {
        open = new Map();
        return walk(c);
      }
      const here = new Map<string, Mark>();
      const extra: Mark[] = [];
      for (const m of c.marks ?? []) {
        const entry = m.type === "glossaryTerm" ? entries.get(m.attrs?.id ?? "") : undefined;
        if (!entry) continue;
        const mark = open.get(entry.id) ?? indexMark({ id: `${prefix}${n++}`, term: entry.term });
        here.set(entry.id, mark);
        extra.push(mark);
      }
      open = here;
      return extra.length ? { ...c, marks: [...(c.marks ?? []), ...extra] } : c;
    });
    return { ...node, content } as DocNode;
  };
  return walk(doc as DocNode) as ChapterDoc;
}

/**
 * The generated index and glossary of a book for the exporters, from the manifest's settings and the pages being exported. A page
 * the author did not switch on is left out, glossary entries with no definition are left out, and with `inIndex` each used glossary
 * term is listed in the index. `language` sorts the terms.
 */
export function indexingForExport<P extends { id: string; doc: ChapterDoc }>(
  manifest: Manifest,
  pages: readonly P[],
  language: string,
): ExportIndexing<P> {
  const { index, glossary } = manifest;
  const glossaryOn = glossary?.enabled === true;
  const defined = new Map(
    (glossary?.entries ?? []).filter((e) => e.definition.trim() !== "").map((e) => [e.id, e]),
  );
  const marked =
    glossaryOn && glossary?.inIndex && defined.size
      ? pages.map((p, i) => ({ ...p, doc: withGlossaryInIndex(p.doc, defined, `gx${i}-`) }))
      : [...pages];
  const out: ExportIndexing<P> = { pages: marked };
  if (index?.enabled) {
    out.index = {
      heading: index.heading,
      letterHeadings: index.letterHeadings,
      ranges: index.ranges,
      columns: index.columns,
      tree: buildIndex(collectIndexMarks(marked), {
        locale: language,
        hidden: index.hidden,
        hideSingles: index.hideSingles,
      }),
    };
  }
  if (glossary && glossaryOn) {
    out.glossary = {
      heading: glossary.heading,
      markFirstUse: glossary.markFirstUse,
      items: buildGlossary(glossary.entries, collectGlossaryUses(pages), {
        locale: language,
        order: glossary.order,
      }).items,
    };
  }
  return out;
}
