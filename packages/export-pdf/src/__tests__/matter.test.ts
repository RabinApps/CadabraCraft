import { describe, expect, it } from "vitest";
import type { ChapterDoc } from "@cadabracraft/shared";
import { PdfExportError } from "../errors";
import { loadMatterBook, matterPages, page } from "./matterBook";
import { buildTypst } from "../typst";

const book = { title: "The Long Quay", author: "Test Author", language: "en" };
const doc = (t: string): ChapterDoc => ({
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text: t }] }],
});
const chapter = (id: string, title: string) => ({ id, title, doc: doc(title) });

describe("buildTypst with front and back matter", () => {
  const { all, chapters } = loadMatterBook();
  const src = buildTypst(book, all);

  it("is deterministic and leaves books without matter free of numbering switches", () => {
    expect(buildTypst(book, all)).toBe(src);
    const plain = buildTypst(book, chapters);
    expect(plain).not.toContain("numbering:");
    expect(plain).not.toContain("#title-page(");
    expect(plain).not.toContain("counter(page).update");
  });
  it("numbers front matter in lowercase roman and restarts arabic numbering at the first chapter", () => {
    expect(src).toContain('numbering: "i"');
    const restart =
      '#pagebreak(weak: true, to: "odd")\n#set page(numbering: "1")\n#counter(page).update(1)\n#mark("numbering-arabic")\n\n#chapter-start("The Quay", 1,';
    expect(src).toContain(restart);
    expect(src.split("#counter(page).update(1)")).toHaveLength(2); // exactly once
    expect(src.indexOf(restart)).toBeGreaterThan(src.indexOf('#chapter-start("Preface", none,'));
  });
  it("uses dedicated layouts for title, copyright and dedication, and chapter openings for the rest", () => {
    expect(src).toContain("#title-page(");
    expect(src).toContain("#copyright-page(");
    expect(src).toContain("#centered-page(");
    expect(src).toContain('#chapter-start("Foreword", none,');
    expect(src).toContain('#chapter-start("Acknowledgments", none,');
    expect(src).toContain('#chapter-start("About the Author", none,');
    expect(src).toContain("© 2026 Test Author");
  });
  it("numbers only chapters, not matter pages", () => {
    expect(src).toContain('#chapter-start("The Quay", 1,');
    expect(src).toContain('#chapter-start("Afterword", 4,');
    expect(src.match(/#chapter-start\("[^"]*", \d+, id:/g)).toHaveLength(4);
  });
  it("opens title page and dedication on a right-hand page and forces the page after a dedication to follow", () => {
    expect(src).toMatch(/#pagebreak\(weak: true, to: "odd"\)\n\n#title-page\(/);
    expect(src).toMatch(/#pagebreak\(weak: true, to: "odd"\)\n\n#centered-page\(/);
    // the foreword follows the dedication: blank verso even for a template that starts chapters on any page
    expect(
      buildTypst(book, all, { template: "modern", fonts: { body: "Libertinus Serif" } }),
    ).toMatch(
      /#centered-page\([\s\S]*?\]\n\n#pagebreak\(weak: true, to: "odd"\)\n\n#chapter-start\("Foreword", none,/,
    );
    // the copyright page follows the title page on the back of it
    expect(src).toMatch(/#title-page\([\s\S]*?\]\n\n#copyright-page\(/);
  });
  it("forces the first chapter onto a right-hand page after front matter, whatever the template", () => {
    const modern = buildTypst(
      book,
      [...matterPages().front, chapter("c1", "One"), chapter("c2", "Two")],
      { template: "modern" },
    );
    expect(modern).toContain('#pagebreak(weak: true, to: "odd")\n#set page(numbering: "1")');
    expect(modern.match(/to: "odd"/g)!.length).toBeGreaterThan(0);
    const noFront = buildTypst(book, [chapter("c1", "One")], { template: "modern" });
    expect(noFront).not.toContain('to: "odd"');
  });
  it("hides headers on matter pages that should not have them and numbers on title and copyright", () => {
    expect(src).toContain("no-header-pages()");
    expect(src).toContain("no-folio-pages()");
    expect(src).toContain('matter-marks(id, kind, "folio-off-start", "folio-off-end"');
    expect(src).toContain('matter-marks(id, kind, "header-off-start", "header-off-end"');
  });
  it("back matter alone does not touch numbering; no restart without front matter", () => {
    const s = buildTypst(book, [chapter("c1", "One"), ...matterPages().back]);
    expect(s).not.toContain("numbering:");
    expect(s).toContain('#chapter-start("Acknowledgments", none,');
  });
  it("front matter alone gets roman numbering and no restart", () => {
    const s = buildTypst(book, matterPages().front);
    expect(s).toContain('numbering: "i"');
    expect(s).not.toContain("counter(page).update");
  });
  it("hides the chapter label of nonfiction templates on matter pages", () => {
    const s = buildTypst(book, all, { template: "nonfiction" });
    expect(s).toContain("if n != none {");
    expect(s).toContain('#chapter-start("Foreword", none,');
    expect(s).toContain('#chapter-start("The Quay", 1,');
  });
  it("escapes matter titles and content", () => {
    const s = buildTypst(book, [
      page("fm-1", 'He said "#hi"', "front", "foreword", doc("= #x $ y")),
    ]);
    expect(s).toContain('#chapter-start("He said \\"#hi\\"", none,');
    expect(s).toContain("\\= \\#x \\$ y");
  });
  it("still throws on unsupported nodes inside matter pages", () => {
    const bad: ChapterDoc = { type: "doc", content: [{ type: "bogus" } as never] };
    expect(() => buildTypst(book, [page("fm-1", "T", "front", "custom", bad)])).toThrow(
      /Unsupported node type/,
    );
  });
  it("rejects a kind in the wrong section", () => {
    expect(() => buildTypst(book, [page("x", "X", "back", "dedication", doc("x"))])).toThrow(
      PdfExportError,
    );
    expect(() => buildTypst(book, [{ ...chapter("x", "X"), kind: "custom" }])).toThrow(/chapter/);
  });
});
