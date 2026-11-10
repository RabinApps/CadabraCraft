import { describe, expect, it } from "vitest";
import {
  buildGlossary,
  buildIndex,
  collectGlossaryUses,
  collectIndexMarks,
  type ChapterDoc,
  type DocNode,
  type GlossaryEntry,
  type Mark,
} from "@cadabracraft/shared";
import { buildTypst } from "../index";
import { seeWords } from "../strings";
import type { PdfBook, PdfChapter, PdfOptions } from "../types";

const book: PdfBook = { title: "The Long Quay", author: "A. Writer", language: "en" };
const t = (text: string, ...marks: Mark[]): DocNode => ({ type: "text", text, marks });
const ix = (id: string, term: string, extra: Record<string, string> = {}): Mark => ({
  type: "indexEntry",
  attrs: { id, term, ...extra },
});
const para = (...content: DocNode[]): DocNode => ({ type: "paragraph", content });
const doc = (...content: DocNode[]): ChapterDoc => ({ type: "doc", content });
const heading = (text: string): DocNode => ({
  type: "heading",
  attrs: { level: 1 },
  content: [{ type: "text", text }],
});

const chapters = (): PdfChapter[] => [
  {
    id: "ch-1",
    title: "One",
    doc: doc(
      heading("One"),
      para(t("the wall", ix("a", "Orchard", { sub: "wall" })), t(" and Magic")),
    ),
  },
  {
    id: "ch-2",
    title: "Two",
    doc: doc(
      heading("Two"),
      para(t("x", ix("b", "Magic", { see: "Sorcery" })), t(" "), t("y", ix("c", "Sorcery"))),
    ),
  },
];
const entries: GlossaryEntry[] = [
  { id: "harbour", term: "Harbour", definition: 'Where "boats" tie up.\n\nSecond paragraph.' },
  { id: "tide", term: "Long tide", definition: "" },
];
const sources = () => chapters().map((c) => ({ id: c.id, doc: c.doc }));
const options = (o: Partial<PdfOptions> = {}): PdfOptions => ({
  index: {
    heading: "Index",
    letterHeadings: true,
    ranges: true,
    columns: 2,
    tree: buildIndex(collectIndexMarks(sources())),
  },
  glossary: {
    heading: "Glossary",
    markFirstUse: true,
    items: buildGlossary(entries, collectGlossaryUses(sources())).items,
  },
  ...o,
});

describe("index entry marks in the Typst source", () => {
  it("writes an invisible place mark before the marked words and nothing else", () => {
    const src = buildTypst(book, chapters());
    expect(src).toContain('#mark("index-place", info: (id: "a"))#[the wall]');
    expect(src).toContain('#mark("index-place", info: (id: "c"))#[y]');
    expect(src).not.toContain("index-list");
    expect(src).not.toContain("glossary-entry");
  });
});

describe("an index entry without an id", () => {
  it("writes an empty id, which the validator refuses before it gets here", () => {
    const src = buildTypst(book, [
      { id: "c", title: "C", doc: doc(para(t("x", { type: "indexEntry", attrs: { term: "T" } }))) },
    ]);
    expect(src).toContain('#mark("index-place", info: (id: ""))#[x]');
  });
});

describe("the index page in the Typst source", () => {
  const src = buildTypst(book, chapters(), options());

  it("is a back-matter page after the chapters, titled by the heading", () => {
    expect(src).toContain('#chapter-start("Index", none, id: "generated-index", kind: "custom")');
    expect(src.indexOf("generated-index")).toBeGreaterThan(src.indexOf('id: "ch-2"'));
  });

  it("defines the list once and calls it with the entries, the settings and the words of the language", () => {
    expect(src.match(/#let index-list\(/g)).toHaveLength(1);
    expect(src).toContain("#index-list((");
    expect(src).toContain(
      '(letter: "M", terms: ((term: "Magic", places: (), subs: (), see: ("Sorcery",), seeAlso: ()),)),',
    );
    expect(src).toContain(
      '(term: "Orchard", places: (), subs: ((term: "wall", places: ("a",)),), see: (), seeAlso: ())',
    );
    expect(src).toContain('), true, true, "See", "See also", 2)');
  });

  it("numbers places like the footer: roman before the arabic mark when the book has front matter, arabic from the start without", () => {
    const front: PdfChapter = {
      id: "pre",
      title: "Preface",
      doc: doc(heading("Preface"), para(t("p", ix("z", "Preface term")))),
      section: "front",
      kind: "preface",
    };
    const withFront = buildTypst(book, [front, ...chapters()], options());
    expect(withFront).toContain(
      "let first-arabic = if arabic.len() > 0 { arabic.first() } else { 1000000 }",
    );
    expect(src).toContain("let first-arabic = 0");
  });

  it("passes the settings through and uses the words of the book's language", () => {
    const fr = buildTypst(
      { ...book, language: "fr" },
      chapters(),
      options({ index: { ...options().index!, ranges: false, letterHeadings: false, columns: 1 } }),
    );
    expect(fr).toContain('), false, false, "Voir", "Voir aussi", 1)');
  });
});

describe("the glossary page in the Typst source", () => {
  const src = buildTypst(book, chapters(), options());

  it("follows the index and lists only entries with a definition, with the text escaped", () => {
    expect(src.indexOf("generated-glossary")).toBeGreaterThan(src.indexOf("generated-index"));
    expect(src).toContain(
      '#glossary-entry("Harbour", "Where \\"boats\\" tie up.\\n\\nSecond paragraph.")',
    );
    expect(src).not.toContain("Long tide");
    expect(src).toContain("#let glossary-entry(");
  });

  it("is written without an index, and neither page is written when there is nothing to list", () => {
    const only = buildTypst(book, chapters(), { glossary: options().glossary! });
    expect(only).toContain("glossary-entry");
    expect(only).not.toContain("index-list");
    const none = buildTypst(book, chapters(), {
      index: { ...options().index!, tree: { groups: [], problems: [] } },
      glossary: { ...options().glossary!, items: [] },
    });
    expect(none).not.toContain("generated-index");
    expect(none).not.toContain("generated-glossary");
  });
});

describe("reserved ids and cross-reference words", () => {
  it("refuses a page that uses an id the generated pages need", () => {
    for (const id of ["generated-index", "generated-glossary"])
      expect(() =>
        buildTypst(book, [...chapters(), { id, title: "x", doc: doc(para(t("x"))) }], options()),
      ).toThrow(/reserved for a generated page/);
  });

  it("has the words in every language the exporter knows and English for others", () => {
    expect(seeWords("de")).toEqual(["Siehe", "Siehe auch"]);
    expect(seeWords("en-GB")).toEqual(["See", "See also"]);
    expect(seeWords("xx")).toEqual(["See", "See also"]);
    expect(seeWords(undefined)).toEqual(["See", "See also"]);
  });
});
