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
import { RtfExportError, buildRtf, type RtfChapter } from "../index";

const t = (text: string, ...marks: Mark[]): DocNode => ({ type: "text", text, marks });
const ix = (id: string, term: string, extra: Record<string, string> = {}): Mark => ({
  type: "indexEntry",
  attrs: { id, term, ...extra },
});
const gl = (id: string): Mark => ({ type: "glossaryTerm", attrs: { id } });
const para = (...content: DocNode[]): DocNode => ({ type: "paragraph", content });
const doc = (...content: DocNode[]): ChapterDoc => ({ type: "doc", content });
const book = { title: "The Long Road", author: "Ada Lovelace" };

const chapters = (): RtfChapter[] => [
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

describe("the index and glossary in a Rich Text file", () => {
  const rtf = buildRtf(book, chapters(), options());

  it("adds an Index page and a Glossary page after the chapters", () => {
    expect(rtf).toContain("Index");
    expect(rtf.indexOf("Index")).toBeGreaterThan(rtf.indexOf("Two"));
    expect(rtf.indexOf("Glossary")).toBeGreaterThan(rtf.indexOf("Index"));
  });

  it("lists the terms with the titles of their pages, subentries and cross-references, and the definitions", () => {
    expect(rtf).toContain("Orchard: One");
    expect(rtf).toContain("wall: One");
    expect(rtf).toContain("See");
    expect(rtf).toContain("Harbour");
    expect(rtf).toContain("Where boats tie up.");
  });

  it("writes nothing extra without them, and refuses a page that uses a reserved id", () => {
    expect(buildRtf(book, chapters())).not.toContain("Glossary");
    for (const id of ["generated-index", "generated-glossary"])
      expect(() =>
        buildRtf(book, [...chapters(), { id, title: "x", doc: doc(para(t("x"))) }], options()),
      ).toThrow(RtfExportError);
  });
});

describe("an index and glossary page the author put in the back matter", () => {
  const slots = (): RtfChapter[] => [
    ...chapters(),
    { id: "bm-1", title: "Terms", doc: doc(), section: "back", kind: "index" },
    {
      id: "bm-2",
      title: "About",
      doc: doc(para(t("Me."))),
      section: "back",
      kind: "about-the-author",
    },
    { id: "bm-3", title: "Words", doc: doc(), section: "back", kind: "glossary" },
  ];

  it("writes each list in its page's place and not again at the end", () => {
    const rtf = buildRtf(book, slots(), options());
    expect(rtf.indexOf("Orchard: One")).toBeGreaterThan(rtf.indexOf("Terms"));
    expect(rtf.indexOf("Me.")).toBeGreaterThan(rtf.indexOf("Orchard: One"));
    expect(rtf.indexOf("Where boats tie up.")).toBeGreaterThan(rtf.indexOf("Me."));
    expect(rtf.match(/Where boats tie up\./g)).toHaveLength(1);
  });

  it("leaves the pages out when there is nothing to list", () => {
    const rtf = buildRtf(book, slots());
    expect(rtf).not.toContain("Terms");
    expect(rtf).toContain("Me.");
  });
});
