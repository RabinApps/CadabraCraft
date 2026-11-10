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
import { bookToMarkdown, chaptersToMarkdown, type MarkdownChapter } from "../index";

const t = (text: string, ...marks: Mark[]): DocNode => ({ type: "text", text, marks });
const ix = (id: string, term: string, extra: Record<string, string> = {}): Mark => ({
  type: "indexEntry",
  attrs: { id, term, ...extra },
});
const gl = (id: string): Mark => ({ type: "glossaryTerm", attrs: { id } });
const para = (...content: DocNode[]): DocNode => ({ type: "paragraph", content });
const doc = (...content: DocNode[]): ChapterDoc => ({ type: "doc", content });

const chapters = (): MarkdownChapter[] => [
  {
    id: "ch-1",
    title: "One",
    doc: doc(
      para(
        t("a", ix("a", "Orchard")),
        t(" "),
        t("b", ix("b", "Orchard", { sub: "wall" })),
        t(" "),
        t("h", gl("harbour")),
      ),
    ),
  },
  {
    id: "ch-2",
    title: "Two",
    doc: doc(
      para(
        t("c", ix("c", "Orchard")),
        t(" "),
        t("d", ix("d", "Orchard")),
        t(" "),
        t("e", ix("e", "Magic", { see: "Sorcery" })),
        t(" "),
        t("f", ix("f", "Sorcery")),
        t(" "),
        t("g", ix("g", "1st trial")),
        t(" "),
        t("h", ix("h", "Magic", { seeAlso: "Missing_" })),
      ),
    ),
  },
];
const sources = () => chapters().map((c) => ({ id: c.id!, doc: c.doc }));
const spec = (letters = true) => ({
  index: {
    heading: "Index",
    letterHeadings: letters,
    ranges: true,
    columns: 2 as const,
    tree: buildIndex(collectIndexMarks(sources())),
  },
  glossary: {
    heading: "Glossary",
    markFirstUse: true,
    items: buildGlossary(
      [
        {
          id: "harbour",
          term: "Harbour",
          definition: "Where boats tie up.\n\nSecond *paragraph*.\nNext line.",
        },
        { id: "tide", term: "Long tide", definition: "" },
      ],
      collectGlossaryUses(sources()),
    ).items,
  },
});

describe("the index in Markdown", () => {
  const pages = chaptersToMarkdown({ title: "T" }, chapters(), spec());
  const index = pages[2]!;

  it("is a page after the chapters and the text of the marks stays", () => {
    expect(pages).toHaveLength(4);
    expect(pages[0]).toBe("# One\n\na b h\n");
    expect(index.startsWith("# Index\n\n")).toBe(true);
  });

  it("lists each term with the chapters it is marked in, the count when more than one, and its subentries", () => {
    expect(index).toContain("- Orchard: One, Two (2)\n  - wall: One");
  });

  it("writes cross-references with the words of the book's language and escapes terms", () => {
    expect(index).toContain("- Magic *See* Sorcery *See also* Missing\\_");
    expect(index).toContain("- Sorcery: Two");
    expect(index).toContain("- 1st trial: Two");
    const fr = chaptersToMarkdown({ title: "T", language: "fr" }, chapters(), spec())[2]!;
    expect(fr).toContain("*Voir* Sorcery *Voir aussi*");
  });

  it("has letter headings, and can leave them out", () => {
    expect(index).toContain("## M\n");
    expect(index).toContain("## O\n");
    const plain = chaptersToMarkdown({ title: "T" }, chapters(), spec(false))[2]!;
    expect(plain).not.toContain("## ");
  });

  it("names a page by its id when the page has no title, and ignores a page with no id", () => {
    const odd: MarkdownChapter[] = [
      { id: "x", title: "", doc: doc(para(t("a", ix("a", "Solo")))) },
      { title: "No id", doc: doc(para(t("b", ix("b", "Other")))) },
    ];
    const out = chaptersToMarkdown({ title: "T" }, odd, {
      index: {
        heading: "Index",
        letterHeadings: false,
        ranges: true,
        columns: 2,
        tree: buildIndex(
          collectIndexMarks([
            { id: "x", doc: odd[0]!.doc },
            { id: "unknown", doc: odd[1]!.doc },
          ]),
        ),
      },
    });
    expect(out[out.length - 1]).toContain("- Solo: x");
    expect(out[out.length - 1]).toContain("- Other: unknown");
  });
});

describe("the glossary in Markdown", () => {
  const pages = chaptersToMarkdown({ title: "T" }, chapters(), spec());
  const glossary = pages[3]!;

  it("follows the index with only the entries that have a definition", () => {
    expect(glossary.startsWith("# Glossary\n\n**Harbour**\n\n")).toBe(true);
    expect(glossary).not.toContain("Long tide");
  });

  it("writes a definition as paragraphs with its text escaped and line breaks kept", () => {
    expect(glossary).toContain("Where boats tie up.\n\nSecond \\*paragraph\\*.  \nNext line.");
  });
});

describe("generated pages in a whole book", () => {
  it("joins them to the book, and leaves them out when there is nothing to list", () => {
    const book = bookToMarkdown({ title: "T" }, chapters(), spec());
    expect(book.indexOf("# Index")).toBeGreaterThan(book.indexOf("# Two"));
    expect(book.indexOf("# Glossary")).toBeGreaterThan(book.indexOf("# Index"));
    const none = chaptersToMarkdown({ title: "T" }, chapters(), {
      index: { ...spec().index, tree: { groups: [], problems: [] } },
      glossary: { ...spec().glossary, items: [] },
    });
    expect(none).toHaveLength(2);
  });
});
