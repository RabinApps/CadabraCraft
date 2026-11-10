import { describe, expect, it } from "vitest";
import {
  buildGlossary,
  buildIndex,
  collectGlossaryUses,
  collectIndexMarks,
  indexLetter,
  isValidGlossaryId,
  isValidIndexEntryId,
  isValidIndexTerm,
  pageRuns,
  termKey,
  type IndexSource,
} from "../index";

const ix = (id: string, term: string, extra: Record<string, string> = {}) => ({
  type: "indexEntry",
  attrs: { id, term, ...extra },
});
const text = (t: string, ...marks: object[]) => ({ type: "text", text: t, marks });
const para = (...content: object[]) => ({ type: "paragraph", content });
const chapter = (id: string, ...content: object[]): IndexSource => ({ id, doc: { content } });

describe("collectIndexMarks", () => {
  it("reads the marks in reading order with the marked words as the snippet", () => {
    const refs = collectIndexMarks([
      chapter("c1", para(text("The "), text("orchard wall", ix("a", "Orchard", { sub: "wall" })))),
      chapter("c2", para(text("Harbour", ix("b", "Harbour")))),
    ]);
    expect(
      refs.map((r) => [r.term, r.sub, r.place.chapterId, r.place.chapterIndex, r.place.snippet]),
    ).toEqual([
      ["Orchard", "wall", "c1", 0, "orchard wall"],
      ["Harbour", undefined, "c2", 1, "Harbour"],
    ]);
  });

  it("joins a mark spread over several text nodes into one place", () => {
    const m = ix("a", "Orchard");
    const refs = collectIndexMarks([
      chapter("c1", para(text("the ", m), text("old", m, { type: "bold" }), text(" wall", m))),
    ]);
    expect(refs).toHaveLength(1);
    expect(refs[0]!.place.snippet).toBe("the old wall");
  });

  it("ends a place at a line break, a paragraph and a gap, and numbers places per chapter", () => {
    const m = ix("a", "Orchard");
    const refs = collectIndexMarks([
      chapter(
        "c1",
        para(text("one", m), { type: "hardBreak" }, text("two", m)),
        para(text("three", m), text(" gap"), text("four", m)),
      ),
      chapter("c2", para(text("five", ix("b", "Tide")))),
    ]);
    expect(refs.map((r) => [r.place.snippet, r.place.order])).toEqual([
      ["one", 0],
      ["two", 1],
      ["three", 2],
      ["four", 3],
      ["five", 0],
    ]);
  });

  it("reads cross-references and ignores marks without an id or a term, other marks and empty text", () => {
    const refs = collectIndexMarks([
      chapter(
        "c1",
        para(
          text("a", ix("a", "Magic", { see: "Sorcery" })),
          text("b", { type: "indexEntry", attrs: { term: "No id" } }),
          text("c", { type: "indexEntry", attrs: { id: "x" } }),
          text("d", { type: "bold" }),
          { type: "text" },
          { type: "text", marks: [ix("n", "Empty")] },
          text("e", ix("e", "More", { seeAlso: "Magic" })),
        ),
      ),
    ]);
    expect(refs.map((r) => [r.term, r.see, r.seeAlso])).toEqual([
      ["Magic", "Sorcery", undefined],
      ["Empty", undefined, undefined],
      ["More", undefined, "Magic"],
    ]);
  });

  it("handles a document with no content", () => {
    expect(collectIndexMarks([{ id: "c", doc: {} }])).toEqual([]);
  });
});

describe("termKey and indexLetter", () => {
  it("compares without case, accents or extra spaces", () => {
    expect(termKey("  Éclair   Shop ")).toBe("eclair shop");
    expect(indexLetter("Éclair")).toBe("E");
    expect(indexLetter("42 ways")).toBe("#");
  });
});

describe("buildIndex", () => {
  const refs = collectIndexMarks([
    chapter(
      "c1",
      para(
        text("a", ix("1", "Orchard", { sub: "planting" })),
        text("b", ix("2", "orchard")),
        text("c", ix("3", "Almanac")),
        text("d", ix("4", "Magic", { see: "Sorcery" })),
        text("e", ix("5", "Magic", { seeAlso: "Missing" })),
        text("f", ix("6", "Orchard", { sub: "Planting" })),
        text("g", ix("7", "Orchard", { sub: "wall" })),
        text("h", ix("8", "42 steps")),
        text("i", ix("9", "Hidden")),
        text("j", ix("10", "Sorcery")),
        text("k", ix("11", "Orchid")),
      ),
    ),
  ]);

  it("groups spellings of a term, nests subentries, sorts and groups by letter", () => {
    const tree = buildIndex(refs, { locale: "en", hidden: ["hidden"] });
    expect(tree.groups.map((g) => g.letter)).toEqual(["#", "A", "M", "O", "S"]);
    const orchard = tree.groups.find((g) => g.letter === "O")!.terms[0]!;
    expect(orchard.term).toBe("Orchard");
    expect(orchard.places.map((p) => p.id)).toEqual(["2"]);
    expect(orchard.subs.map((s) => [s.term, s.places.length])).toEqual([
      ["planting", 2],
      ["wall", 1],
    ]);
  });

  it("lists cross-references and reports targets that have no entry", () => {
    const tree = buildIndex(refs);
    const magic = tree.groups.find((g) => g.letter === "M")!.terms[0]!;
    expect(magic.see).toEqual(["Sorcery"]);
    expect(magic.seeAlso).toEqual(["Missing"]);
    expect(magic.places).toEqual([]);
    expect(tree.problems).toEqual([
      { code: "dangling-see-also", term: "Magic", target: "Missing" },
    ]);
  });

  it("does not repeat a target and keeps places in reading order", () => {
    const two = collectIndexMarks([
      chapter(
        "c2",
        para(
          text("x", ix("a", "Tide", { see: "Sea" })),
          text(" "),
          text("y", ix("b", "Tide", { see: "sea" })),
          text(" "),
          text("w", ix("d", "Tide", { see: "Air" })),
        ),
      ),
      chapter("c1", para(text("z", ix("c", "Tide")))),
    ]);
    const tide = buildIndex(two).groups.find((g) => g.letter === "T")!.terms[0]!;
    expect(tide.see).toEqual(["Air", "Sea"]);
    expect(tide.places.map((p) => p.id)).toEqual(["c"]);
  });

  it("can leave out terms that appear once with nothing else", () => {
    const tree = buildIndex(refs, { hideSingles: true });
    const terms = tree.groups.flatMap((g) => g.terms.map((t) => t.term));
    expect(terms).toContain("Orchard");
    expect(terms).toContain("Magic");
    expect(terms).not.toContain("Almanac");
  });

  it("keeps a single-place term that also has a subentry or a cross-reference", () => {
    const more = collectIndexMarks([
      chapter(
        "c1",
        para(
          text("a", ix("1", "P")),
          text("b", ix("2", "P", { sub: "x" })),
          text("c", ix("3", "Q")),
          text("d", ix("4", "Q", { see: "P" })),
          text("e", ix("5", "R")),
          text("f", ix("6", "R", { seeAlso: "P" })),
          text("g", ix("7", "Lonely")),
        ),
      ),
    ]);
    const names = buildIndex(more, { hideSingles: true }).groups.flatMap((g) =>
      g.terms.map((t) => t.term),
    );
    expect(names).toEqual(["P", "Q", "R"]);
  });

  it("is empty for no marks", () => {
    expect(buildIndex([])).toEqual({ groups: [], problems: [] });
  });
});

describe("glossary", () => {
  const book = [
    chapter(
      "c1",
      para(text("harbour", { type: "glossaryTerm", attrs: { id: "harbour" } })),
      para(text("gone", { type: "glossaryTerm", attrs: { id: "ghost" } }), text("plain")),
    ),
    chapter(
      "c2",
      para(
        text("harbour", { type: "glossaryTerm", attrs: { id: "harbour" } }),
        text("x", { type: "glossaryTerm", attrs: {} }),
        text("y", { type: "bold" }),
      ),
      para(text("again", { type: "glossaryTerm", attrs: { id: "harbour" } })),
    ),
  ];
  const entries = [
    { id: "wall", term: "Orchard wall", definition: "The low stone wall." },
    { id: "harbour", term: "Harbour", definition: "Where boats tie up." },
    { id: "tide", term: "Long tide", definition: " " },
    { id: "dup", term: "harbour", definition: "Again." },
  ];

  it("counts uses, chapters and the first use", () => {
    const uses = collectGlossaryUses(book);
    expect(uses.get("harbour")).toEqual({
      count: 3,
      chapterIds: ["c1", "c2"],
      first: { chapterId: "c1", chapterIndex: 0 },
    });
    expect(uses.get("ghost")!.first.chapterId).toBe("c1");
    expect(collectGlossaryUses([{ id: "c", doc: {} }]).size).toBe(0);
  });

  it("sorts, leaves out undefined entries and reports problems", () => {
    const r = buildGlossary(entries, collectGlossaryUses(book), { locale: "en" });
    expect(r.items.map((i) => i.entry.id)).toEqual(["harbour", "dup", "wall"]);
    expect(r.items[2]!.use).toBeNull();
    expect(r.problems).toEqual([
      { code: "unknown-entry", id: "ghost" },
      { code: "no-definition", id: "tide" },
      { code: "duplicate-term", id: "harbour" },
    ]);
  });

  it("keeps the manifest order and can include undefined entries", () => {
    const r = buildGlossary(entries, new Map(), { order: "added", includeUndefined: true });
    expect(r.items.map((i) => i.entry.id)).toEqual(["wall", "harbour", "tide", "dup"]);
  });
});

describe("pageRuns", () => {
  it("collapses three or more consecutive pages into a range and keeps pairs as two pages", () => {
    expect(pageRuns([15, 12, 13, 14, 20, 21, 30, 12], true)).toEqual([
      { from: 12, to: 15 },
      { from: 20, to: 20 },
      { from: 21, to: 21 },
      { from: 30, to: 30 },
    ]);
  });
  it("lists every page when not collapsing", () => {
    expect(pageRuns([3, 2, 1], false)).toEqual([
      { from: 1, to: 1 },
      { from: 2, to: 2 },
      { from: 3, to: 3 },
    ]);
  });
});

describe("ids and terms", () => {
  it("accepts ids like page ids and terms on one line", () => {
    expect(isValidIndexEntryId("ix-1")).toBe(true);
    expect(isValidGlossaryId("1bad")).toBe(false);
    expect(isValidIndexTerm("Orchard")).toBe(true);
    expect(isValidIndexTerm("  ")).toBe(false);
    expect(isValidIndexTerm("a\nb")).toBe(false);
    expect(isValidIndexTerm("x".repeat(121))).toBe(false);
    expect(isValidIndexTerm(4)).toBe(false);
  });
});
