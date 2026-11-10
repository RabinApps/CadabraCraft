/**
 * Links from the text to the glossary page. A chapter links the first use of each glossary term it contains; the chapter that
 * wrote the link is recorded in `written` so the glossary page links back only to anchors that exist.
 */
export interface GlossaryLinks {
  /** Entries on the glossary page (an entry with no definition is not on it, so it gets no link). */
  ids: ReadonlySet<string>;
  /** Link the first use in each chapter. Off: terms are plain text. */
  markFirstUse: boolean;
  /** File name (no extension) of the glossary page. */
  page: string;
  /** Entry id to the id of the first chapter that wrote a link to it. Filled while the chapters are written. */
  written: Map<string, string>;
}

/** Id of the anchor a chapter writes at the first use of a glossary entry. */
export const glossaryUseId = (entryId: string): string => `gl-use-${entryId}`;
/** Id of an entry on the glossary page. */
export const glossaryEntryId = (entryId: string): string => `gl-${entryId}`;

/** Where one chapter is in writing its glossary links. */
export interface GlossaryWalk {
  links: GlossaryLinks;
  chapterId: string;
  seen: Set<string>;
}

/**
 * The tags to write around a use of glossary entry `id`: a link to the entry for the first use in the chapter that is not already
 * inside a link, plain text otherwise (a link cannot contain a link).
 */
export function glossaryTags(
  id: unknown,
  walk: GlossaryWalk | undefined,
  insideLink: boolean,
): [string, string] {
  if (
    !walk ||
    typeof id !== "string" ||
    insideLink ||
    !walk.links.markFirstUse ||
    !walk.links.ids.has(id) ||
    walk.seen.has(id)
  )
    return ["", ""];
  walk.seen.add(id);
  if (!walk.links.written.has(id)) walk.links.written.set(id, walk.chapterId);
  return [
    `<a epub:type="glossref" role="doc-glossref" class="glossary-term" id="${glossaryUseId(id)}" href="${walk.links.page}.xhtml#${glossaryEntryId(id)}">`,
    "</a>",
  ];
}
