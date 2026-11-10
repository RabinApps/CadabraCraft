import { unzipSync, strFromU8 } from "fflate";
import { XMLValidator } from "fast-xml-parser";
import { describe, expect, it } from "vitest";
import {
  buildGlossary,
  buildIndex,
  collectGlossaryUses,
  collectIndexMarks,
  type ChapterDoc,
  type DocNode,
  type Mark,
} from "@cadabracraft/shared";
import { DocxExportError, buildDocx, type DocxChapter } from "../index";

const t = (text: string, ...marks: Mark[]): DocNode => ({ type: "text", text, marks });
const ix = (id: string, term: string, extra: Record<string, string> = {}): Mark => ({
  type: "indexEntry",
  attrs: { id, term, ...extra },
});
const gl = (id: string): Mark => ({ type: "glossaryTerm", attrs: { id } });
const para = (...content: DocNode[]): DocNode => ({ type: "paragraph", content });
const doc = (...content: DocNode[]): ChapterDoc => ({ type: "doc", content });
const book = { title: "The Long Road", author: "Ada Lovelace" };

const chapters = (): DocxChapter[] => [
  {
    id: "ch-1",
    title: "One",
    doc: doc(
      para(
        t("a", ix("a", "Orchard", { sub: "wall" })),
        t(" "),
        t("b", ix("b", "Orchard")),
        t(" "),
        t("h", gl("harbour")),
      ),
    ),
  },
  { id: "ch-2", title: "Two", doc: doc(para(t("c", ix("c", "Magic", { see: "Sorcery" })))) },
];
const sources = () => chapters().map((c) => ({ id: c.id!, doc: c.doc }));
const options = () => ({
  index: {
    heading: "Index",
    letterHeadings: true,
    ranges: true,
    columns: 2 as const,
    tree: buildIndex(collectIndexMarks(sources())),
  },
  glossary: {
    heading: "Glossary",
    markFirstUse: true,
    items: buildGlossary(
      [{ id: "harbour", term: "Harbour", definition: "Where boats tie up." }],
      collectGlossaryUses(sources()),
    ).items,
  },
});
const documentXml = (cs: DocxChapter[], o = options()): string =>
  strFromU8(unzipSync(buildDocx(book, cs, o))["word/document.xml"]!);

describe("the index and glossary in a Word file", () => {
  const xml = documentXml(chapters());

  it("is well-formed and writes the text of the marks as plain text", () => {
    expect(XMLValidator.validate(xml)).toBe(true);
    expect(xml).toContain(">a<");
  });

  it("adds an Index page and a Glossary page after the chapters, each with its own heading", () => {
    const headings = [
      ...xml.matchAll(/<w:pStyle w:val="Heading1"\/>.*?<w:t[^>]*>([^<]*)<\/w:t>/g),
    ].map((m) => m[1]);
    expect(headings).toEqual(["One", "Two", "Index", "Glossary"]);
    expect(xml.indexOf("Index")).toBeGreaterThan(xml.indexOf(">Two<"));
    expect(xml.indexOf("Glossary")).toBeGreaterThan(xml.indexOf("Index"));
  });

  it("lists the terms with the titles of their pages, subentries and cross-references, and the definitions", () => {
    expect(xml).toContain("Orchard: One");
    expect(xml).toContain("wall: One");
    expect(xml).toContain("Magic");
    expect(xml).toContain(">See<");
    expect(xml).toContain(">Harbour<");
    expect(xml).toContain("Where boats tie up.");
  });

  it("writes nothing extra without them, and refuses a page that uses a reserved id", () => {
    const plain = strFromU8(unzipSync(buildDocx(book, chapters()))["word/document.xml"]!);
    expect(plain).not.toContain("Glossary");
    for (const id of ["generated-index", "generated-glossary"])
      expect(() =>
        buildDocx(book, [...chapters(), { id, title: "x", doc: doc(para(t("x"))) }], options()),
      ).toThrow(DocxExportError);
  });
});
