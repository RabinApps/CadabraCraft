import { termKey, type ChapterDoc, type Mark } from "@cadabracraft/shared";
import { mapMarks, type Edited } from "./docMarks";

type Attrs = NonNullable<Mark["attrs"]>;

/** An `indexEntry` mark with its attributes, leaving out the ones that are not set. */
export function indexMark(attrs: {
  id: string;
  term: string;
  sub?: string | undefined;
  see?: string | undefined;
  seeAlso?: string | undefined;
}): Mark {
  const { id, term, sub, see, seeAlso } = attrs;
  return {
    type: "indexEntry",
    attrs: {
      id,
      term,
      ...(sub ? { sub } : {}),
      ...(see ? { see } : {}),
      ...(seeAlso ? { seeAlso } : {}),
    },
  };
}

/** The mark with `change` applied to its attributes (an attribute set to undefined is dropped). */
const withAttrs = (m: Mark, change: Partial<Record<keyof Attrs, string | undefined>>): Mark => {
  const next: Record<string, string | undefined> = { ...m.attrs, ...change };
  const attrs = Object.fromEntries(Object.entries(next).filter(([, v]) => v)) as Attrs;
  return { ...m, attrs };
};

const isTerm = (m: Mark, term: string): boolean =>
  m.type === "indexEntry" && termKey(m.attrs?.term ?? "") === termKey(term);

/** A cross-reference target that named `from` now names `to`. */
const retarget = (m: Mark, from: string, to: string): Mark => {
  const see = m.attrs?.see && termKey(m.attrs.see) === termKey(from) ? to : m.attrs?.see;
  const seeAlso =
    m.attrs?.seeAlso && termKey(m.attrs.seeAlso) === termKey(from) ? to : m.attrs?.seeAlso;
  return withAttrs(m, { see, seeAlso });
};

/**
 * Renames a term (and merges it into `to` when that term exists: the marks simply carry the same heading). Cross-references
 * that pointed at the old name follow it.
 */
export function renameTerm(doc: ChapterDoc, from: string, to: string): Edited {
  return mapMarks(doc, (m) => {
    if (m.type !== "indexEntry") return undefined;
    const renamed = isTerm(m, from) ? withAttrs(m, { term: to }) : m;
    const next = retarget(renamed, from, to);
    return next.attrs?.term === m.attrs?.term &&
      next.attrs?.see === m.attrs?.see &&
      next.attrs?.seeAlso === m.attrs?.seeAlso
      ? undefined
      : next;
  });
}

/** Puts a top-level term under another: its own marks (not its subentries) become subentries of `parent`. */
export function moveUnder(doc: ChapterDoc, term: string, parent: string): Edited {
  return mapMarks(doc, (m) =>
    isTerm(m, term) && !m.attrs?.sub ? withAttrs(m, { term: parent, sub: term }) : undefined,
  );
}

/** Takes every mark of a term away (its subentries and cross-references too); the words stay. */
export function removeTerm(doc: ChapterDoc, term: string): Edited {
  return mapMarks(doc, (m) => (isTerm(m, term) ? null : undefined));
}

/** Takes the mark of one place away; the words stay. */
export function removePlace(doc: ChapterDoc, id: string): Edited {
  return mapMarks(doc, (m) => (m.type === "indexEntry" && m.attrs?.id === id ? null : undefined));
}

interface Raw {
  marks?: { type?: string; attrs?: { id?: string } }[];
  content?: Raw[];
}

/** True when the document has a use of glossary entry `entryId` somewhere. */
export function usesGlossaryEntry(doc: ChapterDoc, entryId: string): boolean {
  const walk = (n: Raw): boolean =>
    (n.marks ?? []).some((m) => m.type === "glossaryTerm" && m.attrs?.id === entryId) ||
    (n.content ?? []).some(walk);
  return walk(doc as Raw);
}

/** Takes every use of a glossary entry away; the words stay. */
export function removeGlossaryUses(doc: ChapterDoc, entryId: string): Edited {
  return mapMarks(doc, (m) =>
    m.type === "glossaryTerm" && m.attrs?.id === entryId ? null : undefined,
  );
}
