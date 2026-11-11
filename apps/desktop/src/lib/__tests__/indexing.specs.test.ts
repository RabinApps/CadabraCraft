import { describe, expect, it } from "vitest";
import { defaultGlossarySettings, defaultIndexSettings, type Manifest } from "@cadabracraft/format";
import type { ChapterDoc, GlossaryEntry, Mark } from "@cadabracraft/shared";
import { deriveIndexData } from "../indexing/indexData";
import { indexingForExport, withGeneratedPages, withGlossaryInIndex } from "../indexing/pageSpecs";
import { indexMark } from "../indexing/termOps";
import {
  danglingTargets,
  filterGlossary,
  filterIndex,
  placeCount,
  termCount,
} from "../indexing/panelModel";
import { entryProblem, parseAliases, termProblem } from "../indexing/validation";
import { entryErrors, entryProblemText, termProblemText } from "../indexing/problemText";
import { requestMarkJump, takeMarkJump, useMarkJump } from "../../state/pages/markJump";
import { setMarkOpeners, useMarkAnchor } from "../indexing/anchor";

const tx = (text: string, marks?: Mark[]) => ({
  type: "text" as const,
  text,
  ...(marks ? { marks } : {}),
});
const page = (id: string, ...c: ReturnType<typeof tx>[]) => ({
  id,
  doc: { type: "doc", content: [{ type: "paragraph", content: c }] } as ChapterDoc,
});
const gl = (id: string): Mark => ({ type: "glossaryTerm", attrs: { id } });
const entry = (id: string, term: string, definition = "A thing."): GlossaryEntry => ({
  id,
  term,
  definition,
});
const pages = [
  page("c1", tx("magic", [indexMark({ id: "a", term: "Magic" })]), tx(" orb", [gl("g1")])),
  page("c2", tx("wizard", [indexMark({ id: "b", term: "Wizards", see: "Sorcery" })])),
];
const manifest = (over: Partial<Manifest>): Manifest => ({ ...({} as Manifest), ...over });

describe("indexingForExport", () => {
  it("writes nothing for a book that switched nothing on", () => {
    const r = indexingForExport(manifest({}), pages, "en");
    expect(r.index).toBeUndefined();
    expect(r.glossary).toBeUndefined();
    expect(r.pages).toEqual(pages);
  });

  it("builds the index with the author's settings, hidden terms and single-use filter", () => {
    const index = { ...defaultIndexSettings(), enabled: true, columns: 1 as const, ranges: false };
    const r = indexingForExport(manifest({ index }), pages, "en");
    expect(r.index).toMatchObject({ heading: "Index", columns: 1, ranges: false });
    expect(r.index!.tree.groups.flatMap((g) => g.terms.map((t) => t.term))).toEqual([
      "Magic",
      "Wizards",
    ]);
    const hidden = indexingForExport(
      manifest({ index: { ...index, hidden: ["magic"], hideSingles: true } }),
      pages,
      "en",
    );
    expect(hidden.index!.tree.groups.flatMap((g) => g.terms.map((t) => t.term))).toEqual([
      "Wizards",
    ]);
  });

  it("builds the glossary from entries with a definition, in the book's order", () => {
    const glossary = {
      ...defaultGlossarySettings(),
      enabled: true,
      markFirstUse: false,
      entries: [entry("g2", "Zed"), entry("g1", "Orb"), entry("g3", "Empty", "  ")],
    };
    const r = indexingForExport(manifest({ glossary }), pages, "en");
    expect(r.glossary!.items.map((i) => i.entry.term)).toEqual(["Orb", "Zed"]);
    expect(r.glossary!.markFirstUse).toBe(false);
    const added = indexingForExport(
      manifest({ glossary: { ...glossary, order: "added" } }),
      pages,
      "en",
    );
    expect(added.glossary!.items.map((i) => i.entry.term)).toEqual(["Zed", "Orb"]);
    expect(
      indexingForExport(manifest({ glossary: { ...glossary, enabled: false } }), pages, "en")
        .glossary,
    ).toBeUndefined();
  });

  it("lists used glossary terms in the index as places of their own, in memory only", () => {
    const glossary = {
      ...defaultGlossarySettings(),
      enabled: true,
      inIndex: true,
      entries: [entry("g1", "Orb")],
    };
    const index = { ...defaultIndexSettings(), enabled: true };
    const r = indexingForExport(manifest({ glossary, index }), pages, "en");
    const terms = r.index!.tree.groups.flatMap((g) => g.terms);
    expect(terms.map((t) => t.term)).toContain("Orb");
    expect(terms.find((t) => t.term === "Orb")!.places).toHaveLength(1);
    expect(JSON.stringify(pages)).not.toContain("gx");
    expect(JSON.stringify(r.pages)).toContain("gx0-0");
  });

  it("gives a use that spans two pieces of text one place, and entries with no definition none", () => {
    const entries = new Map([["g1", entry("g1", "Orb")]]);
    const d = page(
      "c",
      tx("big ", [gl("g1")]),
      tx("orb", [gl("g1"), { type: "bold" }]),
      tx(" x"),
      tx("orb", [gl("g1")]),
      tx("q", [gl("none")]),
    ).doc;
    const out = withGlossaryInIndex(d, entries, "p");
    const ids = (out.content[0] as { content: { marks?: Mark[] }[] }).content.map((n) =>
      (n.marks ?? []).filter((m) => m.type === "indexEntry").map((m) => m.attrs!.id),
    );
    expect(ids).toEqual([["p0"], ["p0"], [], ["p1"], []]);
    expect(withGlossaryInIndex(d, new Map(), "p")).toEqual(d);
  });
});

describe("panel model", () => {
  const data = deriveIndexData(
    pages,
    { ...defaultGlossarySettings(), entries: [entry("g1", "Orb"), entry("g2", "Unused", "")] },
    "en",
  );

  it("derives the index tree and the glossary with uses", () => {
    expect(termCount(data.tree)).toBe(2);
    expect(data.uses.get("g1")!.count).toBe(1);
    expect(data.glossary.items.map((i) => i.entry.term)).toEqual(["Orb", "Unused"]);
    expect(deriveIndexData(pages, undefined, "en").glossary.items).toEqual([]);
  });

  it("filters terms by search and by what needs attention", () => {
    const names = (q: string, f: Parameters<typeof filterIndex>[2]) =>
      filterIndex(data.tree, q, f).flatMap((g) => g.terms.map((t) => t.term));
    expect(names("", "all")).toEqual(["Magic", "Wizards"]);
    expect(names("MAG", "all")).toEqual(["Magic"]);
    expect(names("sorcery", "all")).toEqual(["Wizards"]);
    expect(names("", "xrefs")).toEqual(["Wizards"]);
    expect(names("", "attention")).toEqual(["Wizards"]);
    expect(names("zzz", "all")).toEqual([]);
    expect(danglingTargets(data.tree, "wizards")).toEqual(["Sorcery"]);
    expect(danglingTargets(data.tree, "Magic")).toEqual([]);
    expect(placeCount(data.tree.groups[0]!.terms[0]!)).toBe(1);
  });

  it("counts the places of subentries with the term's own", () => {
    const subs = deriveIndexData(
      [
        page(
          "c1",
          tx("a", [indexMark({ id: "s1", term: "Magic", sub: "spells" })]),
          tx("b", [indexMark({ id: "s2", term: "Magic" })]),
        ),
      ],
      undefined,
      "en",
    );
    expect(placeCount(subs.tree.groups[0]!.terms[0]!)).toBe(2);
    expect(filterIndex(subs.tree, "spell", "all")).toHaveLength(1);
  });

  it("filters glossary entries by search, definition and use", () => {
    const names = (q: string, f: Parameters<typeof filterGlossary>[2]) =>
      filterGlossary(data.glossary.items, q, f).map((i) => i.entry.term);
    expect(names("", "all")).toEqual(["Orb", "Unused"]);
    expect(names("", "undefined")).toEqual(["Unused"]);
    expect(names("", "unused")).toEqual(["Unused"]);
    expect(names("a thing", "all")).toEqual(["Orb"]);
    expect(names("orb", "unused")).toEqual([]);
  });
});

describe("validation", () => {
  it("checks index terms", () => {
    expect(termProblem(" ")).toBe("empty");
    expect(termProblem("a\nb")).toBe("lines");
    expect(termProblem("x".repeat(121))).toBe("long");
    expect(termProblem("fine")).toBeNull();
    expect(termProblemText("empty")).not.toBe(termProblemText("long"));
    expect(termProblemText("lines")).toBeTruthy();
  });

  it("splits aliases, dropping blanks and repeats", () => {
    expect(parseAliases("orbs, Orbs; globe\n , ")).toEqual(["orbs", "globe"]);
  });

  it("checks glossary entries and words each problem for its field", () => {
    const others = [entry("a", "Orb")];
    const ok = { id: "b", term: "Globe", aliases: [], definition: "" };
    expect(entryProblem(ok, others)).toBeNull();
    expect(entryProblem({ ...ok, term: "" }, others)).toBe("term-empty");
    expect(entryProblem({ ...ok, term: "orb" }, others)).toBe("term-used");
    expect(entryProblem({ ...ok, id: "a", term: "ORB" }, others)).toBeNull();
    expect(entryProblem({ ...ok, aliases: Array(13).fill("x") }, others)).toBe("aliases-many");
    expect(entryProblem({ ...ok, aliases: [" "] }, others)).toBe("alias");
    expect(entryProblem({ ...ok, definition: "x".repeat(2001) }, others)).toBe("definition-long");
    for (const p of [
      "term-empty",
      "term-long",
      "term-lines",
      "term-used",
      "alias",
      "aliases-many",
      "definition-long",
    ] as const)
      expect(entryProblemText(p)).toBeTruthy();
    expect(entryErrors("alias", true)).toHaveProperty("aliases");
    expect(entryErrors("definition-long", true)).toHaveProperty("definition");
    expect(entryErrors("term-used", true)).toHaveProperty("term");
    expect(entryErrors("term-used", false)).toEqual({});
    expect(entryErrors(null, true)).toEqual({});
  });
});

describe("the editor's side of the panels", () => {
  it("keeps a jump for another chapter until its editor opens, and hands it over once", () => {
    requestMarkJump({ chapterId: "c2", kind: "index", id: "b" });
    expect(takeMarkJump("c1")).toBeNull();
    expect(takeMarkJump(null)).toBeNull();
    expect(takeMarkJump("c2")).toEqual({ chapterId: "c2", kind: "index", id: "b" });
    expect(takeMarkJump("c2")).toBeNull();
    expect(useMarkJump.getState().count).toBeGreaterThan(0);
  });

  it("registers and forgets the dialogs that the panels open", () => {
    const f = () => {};
    setMarkOpeners({ openIndex: f, openGlossary: f });
    useMarkAnchor.setState({ hasSelection: true });
    expect(useMarkAnchor.getState().openIndex).toBe(f);
    setMarkOpeners(null);
    expect(useMarkAnchor.getState()).toMatchObject({
      openIndex: null,
      openGlossary: null,
      hasSelection: false,
    });
  });
});

describe("withGeneratedPages", () => {
  const slot = (id: string, kind: string) => ({
    id,
    title: id,
    kind,
    doc: { type: "doc", content: [] } as ChapterDoc,
  });
  const book = [
    ...pages.map((p) => ({ ...p, title: p.id })),
    slot("bm-1", "index"),
    slot("bm-2", "glossary"),
  ];
  const on = manifest({
    index: { ...defaultIndexSettings(), enabled: true },
    glossary: {
      ...defaultGlossarySettings(),
      enabled: true,
      entries: [entry("g1", "Orb")],
    },
  });

  it("returns the pages as they are when none is an index or glossary page", () => {
    const plain = pages.map((p) => ({ ...p, title: p.id }));
    expect(withGeneratedPages(on, plain, "en")).toEqual(plain);
  });

  it("fills an index and a glossary page with the generated list", () => {
    const out = withGeneratedPages(on, book, "en");
    expect(out[0]).toBe(book[0]);
    expect(JSON.stringify(out[2]!.doc)).toContain("Wizards");
    expect(JSON.stringify(out[3]!.doc)).toContain("Orb");
  });

  it("keeps the page's own text when there is nothing to list", () => {
    const out = withGeneratedPages(manifest({}), book, "en");
    expect(out[2]).toBe(book[2]);
    expect(out[3]).toBe(book[3]);
  });
});
