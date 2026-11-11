import { describe, expect, it } from "vitest";
import {
  GENERATED_GLOSSARY_ID,
  GENERATED_INDEX_ID,
  buildGlossary,
  buildIndex,
  collectGlossaryUses,
  collectIndexMarks,
  generatedDocPages,
  placeGeneratedDocPages,
  placePages,
  seeWords,
  seeWordsFor,
  type IndexPageSpec,
} from "../index";

const ix = (id: string, term: string, extra: Record<string, string> = {}) => ({
  type: "indexEntry",
  attrs: { id, term, ...extra },
});
const text = (t: string, ...marks: object[]) => ({ type: "text", text: t, marks });
const para = (...content: object[]) => ({ type: "paragraph", content });
const sources = [
  {
    id: "c1",
    doc: {
      content: [
        para(
          text("a", ix("a", "Orchard", { sub: "wall" })),
          text(" "),
          text("b", ix("b", "Orchard")),
          text(" "),
          text("c", ix("c", "Magic", { see: "Sorcery" })),
        ),
      ],
    },
  },
  {
    id: "c2",
    doc: {
      content: [
        para(
          text("d", ix("d", "Orchard")),
          text(" "),
          text("e", ix("e", "Sorcery")),
          text(" "),
          text("f", ix("f", "Magic", { seeAlso: "Sorcery" })),
          text(" "),
          text("h", { type: "glossaryTerm", attrs: { id: "harbour" } }),
        ),
      ],
    },
  },
];
const titles = new Map([
  ["c1", "One"],
  ["c2", ""],
]);
const index = (letters = true): IndexPageSpec => ({
  heading: "Index",
  letterHeadings: letters,
  ranges: true,
  columns: 2,
  tree: buildIndex(collectIndexMarks(sources)),
});
const glossary = {
  heading: "Glossary",
  markFirstUse: true,
  items: buildGlossary(
    [
      {
        id: "harbour",
        term: "Harbour",
        definition: "Where boats tie up.\n\n \n\nSecond paragraph.",
      },
      { id: "tide", term: "Tide", definition: "" },
    ],
    collectGlossaryUses(sources),
  ).items,
};

describe("placePages", () => {
  it("names each page once with how many places it has, and a page with no title by its id", () => {
    const refs = collectIndexMarks(sources).filter((r) => r.term === "Orchard");
    expect(
      placePages(
        refs.map((r) => r.place),
        titles,
      ),
    ).toEqual([
      { title: "One", count: 2 },
      { title: "c2", count: 1 },
    ]);
  });
});

describe("generatedDocPages", () => {
  const pages = generatedDocPages({ index: index(), glossary }, titles, "en");

  it("is the index then the glossary, each with its heading as the title", () => {
    expect(pages.map((p) => [p.id, p.title])).toEqual([
      [GENERATED_INDEX_ID, "Index"],
      [GENERATED_GLOSSARY_ID, "Glossary"],
    ]);
  });

  it("writes the index as letter headings over bulleted terms with pages, subentries and cross-references", () => {
    const doc = pages[0]!.doc;
    const top = doc.content.map((n) => [n.type, "attrs" in n ? n.attrs?.level : undefined]);
    expect(top).toEqual([
      ["heading", 1],
      ["heading", 2],
      ["bulletList", undefined],
      ["heading", 2],
      ["bulletList", undefined],
      ["heading", 2],
      ["bulletList", undefined],
    ]);
    const json = JSON.stringify(doc);
    expect(json).toContain("Orchard: One, c2");
    expect(json).toContain("wall: One");
    expect(json).toContain('"text":"See"');
    expect(json).toContain('"text":"See also"');
    expect(json).toContain(" Sorcery");
  });

  it("gives the count when a page has a term more than once", () => {
    const twice = buildIndex(
      collectIndexMarks([
        {
          id: "c1",
          doc: {
            content: [para(text("x", ix("x", "Twice")), text(" "), text("y", ix("y", "Twice")))],
          },
        },
      ]),
    );
    const doc = generatedDocPages({ index: { ...index(), tree: twice } }, titles, "en")[0]!.doc;
    expect(JSON.stringify(doc)).toContain("Twice: One (2)");
  });

  it("can leave out the letter headings", () => {
    const doc = generatedDocPages({ index: index(false) }, titles, "fr")[0]!.doc;
    expect(doc.content.filter((n) => n.type === "heading")).toHaveLength(1);
    expect(JSON.stringify(doc)).toContain('"text":"Voir"');
  });

  it("writes the glossary as a bold term and a paragraph per paragraph of its definition", () => {
    const content = pages[1]!.doc.content;
    expect(content).toHaveLength(4);
    expect(JSON.stringify(content[1])).toContain('"type":"bold"');
    expect(JSON.stringify(content.slice(2))).toContain("Where boats tie up.");
    expect(JSON.stringify(content.slice(2))).toContain("Second paragraph.");
    expect(JSON.stringify(content)).not.toContain("Tide");
  });

  it("leaves out a page with nothing to list", () => {
    expect(generatedDocPages({}, titles, "en")).toEqual([]);
    expect(
      generatedDocPages(
        {
          index: { ...index(), tree: { groups: [], problems: [] } },
          glossary: { ...glossary, items: [] },
        },
        titles,
        "en",
      ),
    ).toEqual([]);
  });
});

describe("seeWords", () => {
  it("has the words of every language the exporters know and English for others", () => {
    expect(seeWords("de")).toEqual(["Siehe", "Siehe auch"]);
    expect(seeWords("en-GB")).toEqual(["See", "See also"]);
    expect(seeWords("xx")).toEqual(["See", "See also"]);
    expect(seeWords(undefined)).toEqual(["See", "See also"]);
    expect(seeWordsFor("xx")).toBeUndefined();
    expect(seeWordsFor("ja")).toEqual(["参照", "関連項目"]);
  });
});

describe("placeGeneratedDocPages", () => {
  const doc = (t: string) => ({ type: "doc", content: [para(text(t))] }) as never;
  const page = (id: string, kind?: string) => ({ id, title: id, doc: doc(id), kind });
  const pages = [
    page("ch"),
    page("i", "index"),
    page("x", "about-the-author"),
    page("g", "glossary"),
  ];

  it("fills the pages of kind index and glossary where they sit and adds nothing at the end", () => {
    const out = placeGeneratedDocPages(pages, { index: index(), glossary }, titles, "en");
    expect(out.map((p) => p.id)).toEqual(["ch", "i", "x", "g"]);
    expect(JSON.stringify(out[1]!.doc)).toContain("Orchard");
    expect(JSON.stringify(out[3]!.doc)).toContain("Harbour");
    expect(out[2]).toBe(pages[2]);
  });

  it("drops a page with nothing to list", () => {
    const out = placeGeneratedDocPages(pages, {}, titles, "en");
    expect(out.map((p) => p.id)).toEqual(["ch", "x"]);
  });

  it("appends a list that has no page, index first", () => {
    const out = placeGeneratedDocPages([pages[0]!], { index: index(), glossary }, titles, "en");
    expect(out.map((p) => p.id)).toEqual(["ch", GENERATED_INDEX_ID, GENERATED_GLOSSARY_ID]);
  });
});
