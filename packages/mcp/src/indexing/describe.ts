// The index as the tools report it: every term with its places, whether the export lists it, and what is wrong with it.
import { defaultIndexSettings, type Manifest } from "@cadabracraft/format";
import {
  buildIndex,
  collectIndexMarks,
  termKey,
  type IndexPlace,
  type IndexTerm,
} from "@cadabracraft/shared";
import type { Page } from "./pages";

export interface IndexProblemReport {
  code: "dangling-see" | "dangling-see-also" | "hidden-unused";
  term: string;
  target?: string;
}

export function describeIndex(pages: Page[], manifest: Manifest, language: string) {
  const settings = manifest.index ?? defaultIndexSettings();
  const titles = new Map(pages.map((p) => [p.id, p.title]));
  const refs = collectIndexMarks(pages);
  const full = buildIndex(refs, { locale: language });
  const listed = new Set(
    buildIndex(refs, {
      locale: language,
      hidden: settings.hidden,
      hideSingles: settings.hideSingles,
    })
      .groups.flatMap((g) => g.terms)
      .map((t) => termKey(t.term)),
  );
  const place = (p: IndexPlace) => ({
    id: p.id,
    chapterId: p.chapterId,
    chapterTitle: titles.get(p.chapterId)!,
    snippet: p.snippet,
  });
  const hidden = new Set(settings.hidden.map(termKey));
  const term = (letter: string, t: IndexTerm) => ({
    term: t.term,
    letter,
    hidden: hidden.has(termKey(t.term)),
    listed: listed.has(termKey(t.term)),
    places: t.places.map(place),
    subs: t.subs.map((s) => ({ term: s.term, places: s.places.map(place) })),
    see: t.see,
    seeAlso: t.seeAlso,
  });
  const terms = full.groups.flatMap((g) => g.terms.map((t) => term(g.letter, t)));
  const known = new Set(terms.map((t) => termKey(t.term)));
  const problems: IndexProblemReport[] = [
    ...full.problems,
    ...settings.hidden
      .filter((h) => !known.has(termKey(h)))
      .map((h): IndexProblemReport => ({ code: "hidden-unused", term: h })),
  ];
  return {
    language,
    settings,
    termCount: terms.length,
    placeCount: refs.length,
    terms,
    problems,
  };
}
