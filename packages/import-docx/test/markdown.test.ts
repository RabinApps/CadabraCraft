import { describe, expect, it } from "vitest";
import { importMarkdown } from "../src";
import { MARK_ORDER } from "../src/common";
import { expectValid, schema } from "./helpers";

const codes = (r: ReturnType<typeof importMarkdown>) => r.warnings.map((w) => w.code);

describe("schema contract", () => {
  it("mark order matches the real editor schema", () => {
    const ranked = Object.keys(schema.marks).filter((m) => (MARK_ORDER as string[]).includes(m));
    expect(MARK_ORDER).toEqual(ranked);
  });
});

describe("importMarkdown code blocks", () => {
  it("turns fenced and indented blocks into codeBlock nodes with their text and language", () => {
    const md = ["# T", "", "```js title=x", "let a = 1;", "", "  <b>&</b>", "```", "", "para", "", "    indented", "    code", "", "```", "", "```"].join("\n");
    const r = importMarkdown(md);
    expect(r.warnings).toEqual([]);
    const c = r.chapters[0]!.doc.content;
    expect(c.map((n) => n.type)).toEqual(["heading", "codeBlock", "paragraph", "codeBlock", "codeBlock"]);
    expect(c[1]).toEqual({ type: "codeBlock", attrs: { language: "js" }, content: [{ type: "text", text: "let a = 1;\n\n  <b>&</b>" }] });
    expect(c[3]).toEqual({ type: "codeBlock", content: [{ type: "text", text: "indented\ncode" }] });
    expect(c[4]).toEqual({ type: "codeBlock" });
    expectValid(r);
  });
  it("drops a language that is not a plain token", () => {
    const r = importMarkdown('# T\n\n```"><x\ncode\n```');
    expect(r.chapters[0]!.doc.content[1]).toEqual({ type: "codeBlock", content: [{ type: "text", text: "code" }] });
  });
});

describe("importMarkdown", () => {
  it("splits chapters on H1 and keeps the heading", () => {
    const r = importMarkdown("# One\n\nHello **bold** and *it* and [a](https://x.com).\n\n# Two\n\nBye");
    expect(r.chapters.map((c) => c.title)).toEqual(["One", "Two"]);
    expect(r.chapters[0]!.doc.content[0]).toMatchObject({ type: "heading", attrs: { level: 1 } });
    expect(r.warnings).toEqual([]);
    expectValid(r);
  });

  it("nests marks in schema order", () => {
    const r = importMarkdown("# T\n\n***both*** [***x***](https://a.b)");
    expectValid(r);
  });

  it("puts text before the first heading in Untitled with a warning", () => {
    const r = importMarkdown("Preface\n\n# One\n\nx");
    expect(r.chapters.map((c) => c.title)).toEqual(["Untitled", "One"]);
    expect(codes(r)).toContain("untitled-content");
    expectValid(r);
  });

  it("supports a configurable split level and warns when there are no headings", () => {
    const r = importMarkdown("# Book\n\n## A\n\nx\n\n## B\n\ny", { splitHeadingLevel: 2 });
    expect(r.chapters.map((c) => c.title)).toEqual(["Untitled", "A", "B"]);
    expect(importMarkdown("just text").warnings.map((w) => w.code)).toEqual(["no-headings"]);
  });

  it("clamps h4+ with a located warning", () => {
    const r = importMarkdown("# A\n\n#### Deep\n");
    expect(r.chapters[0]!.doc.content[1]).toMatchObject({ type: "heading", attrs: { level: 3 } });
    expect(r.warnings.find((w) => w.code === "heading-clamped")?.line).toBe(3);
    expectValid(r);
  });

  it("keeps only http/https/mailto links", () => {
    const r = importMarkdown("# A\n\n[ok](mailto:a@b.c) [bad](javascript:alert(1)) [rel](chapter.md)");
    const json = JSON.stringify(r.chapters[0]!.doc);
    expect(json).toContain("mailto:a@b.c");
    expect(json).not.toContain("javascript");
    expect(json).not.toContain("chapter.md\"");
    expect(r.warnings.filter((w) => w.code === "unsafe-link")).toHaveLength(2);
    expectValid(r);
  });

  it("handles quotes, nested lists, ordered start and scene breaks", () => {
    const r = importMarkdown("# A\n\n> quote\n> more\n\n- a\n  - b\n    1. c\n- d\n\n3. x\n4. y\n\n***\n\n---\n");
    const types = r.chapters[0]!.doc.content.map((n) => n.type);
    expect(types).toEqual(["heading", "blockquote", "bulletList", "orderedList", "sceneBreak", "sceneBreak"]);
    expect(r.chapters[0]!.doc.content[3]).toMatchObject({ attrs: { start: 3 } });
    expectValid(r);
  });

  it("converts footnotes into inline footnote nodes", () => {
    const r = importMarkdown("# A\n\nText[^1] more.\n\n[^1]: The *note* text.\n");
    const p = r.chapters[0]!.doc.content[1]!;
    expect(JSON.stringify(p)).toContain('"type":"footnote"');
    expect(JSON.stringify(p)).toContain("The ");
    expect(r.warnings).toEqual([]);
    expectValid(r);
  });

  it("warns about unreferenced footnotes", () => {
    const r = importMarkdown("# A\n\ntext\n\n[^9]: orphan\n");
    expect(codes(r)).toContain("footnote-unreferenced");
  });

  it("records image references without reading disk and dedups targets", () => {
    const r = importMarkdown("# A\n\n![cat](img/cat.png) text ![dog](other/cat.png)\n\n![r](https://x.com/a.png)\n\n![z](pic.bmp)");
    expect(r.assets.map((a) => [a.sourcePath, a.targetPath])).toEqual([
      ["img/cat.png", "assets/cat.png"],
      ["other/cat.png", "assets/cat-2.png"],
    ]);
    expect(r.assets[0]!.bytes).toBeUndefined();
    expect(codes(r)).toEqual(expect.arrayContaining(["remote-image", "unsupported-image"]));
    expectValid(r);
  });

  it("never drops unsupported constructs silently", () => {
    const md = [
      "# A",
      "",
      "```js",
      "let x = 1;",
      "```",
      "",
      "<div>raw</div>",
      "",
      "~~gone~~ and `code`",
      "",
      "- [x] done",
      "- [ ] todo",
    ].join("\n");
    const r = importMarkdown(md);
    expect(codes(r)).toEqual(expect.arrayContaining(["task-list"]));
    expect(codes(r)).not.toContain("html");
    expect(codes(r)).not.toContain("code-block");
    expect(codes(r)).not.toContain("strikethrough");
    expect(codes(r)).not.toContain("inline-code");
    const text = JSON.stringify(r.chapters[0]!.doc);
    for (const s of ["let x = 1;", "raw", "gone", "code", "[x] done", "[ ] todo"]) expect(text).toContain(s);
    expectValid(r);
  });

  it("maps GFM tables to table nodes with a header row, padding ragged rows", () => {
    const r = importMarkdown("# T\n\n| a | **b** |\n|---|---|\n| 1 | 2 |\n| 3 |\n");
    expect(codes(r)).not.toContain("table");
    const table = r.chapters[0]!.doc.content.find((n) => n.type === "table")!;
    const rows = ("content" in table ? table.content : [])!;
    expect(rows).toHaveLength(3);
    expect(JSON.stringify(rows[0])).toContain("tableHeader");
    expect(JSON.stringify(rows[0])).toContain('"marks":[{"type":"bold"}]');
    expect(rows.map((row) => ("content" in row ? row.content : [])!.length)).toEqual([2, 2, 2]);
    expect(JSON.stringify(rows[1])).not.toContain("tableHeader");
    expectValid(r);
  });

  it("maps strikethrough and inline code to marks; code beats surrounding marks", () => {
    const r = importMarkdown("# T\n\n~~gone~~ and `code` and **bold `both`**");
    const para = r.chapters[0]!.doc.content.find((n) => n.type === "paragraph");
    const kids = para && "content" in para ? (para.content ?? []) : [];
    const marksOf = (t: string) => kids.find((n) => n.type === "text" && n.text === t && "marks" in n && n.marks)?.["marks" as never];
    expect(marksOf("gone")).toEqual([{ type: "strike" }]);
    expect(marksOf("code")).toEqual([{ type: "code" }]);
    expect(marksOf("both")).toEqual([{ type: "code" }]);
    expectValid(r);
  });

  it("splits hard breaks into paragraphs and reports it", () => {
    const r = importMarkdown("# A\n\nline one\\\nline two");
    expect(r.chapters[0]!.doc.content).toHaveLength(3);
    expect(codes(r)).toContain("line-break");
    expectValid(r);
  });

  it("empty input yields no chapters and a warning", () => {
    const r = importMarkdown("");
    expect(r.chapters).toEqual([]);
    expect(codes(r)).toEqual(["empty-input"]);
  });
});

describe("HTML inside Markdown", () => {
  const body = (md: string) => importMarkdown(md).chapters[0]!.doc.content;
  const mark = (type: string) => ({ type });

  it("converts block HTML through the HTML importer", () => {
    const r = importMarkdown("# T\n\n<div><p>one <b>two</b></p>\n<ul><li>x</li></ul></div>\n\nafter\n");
    expect(codes(r)).toEqual([]);
    expect(r.chapters[0]!.doc.content.map((n) => n.type)).toEqual(["heading", "paragraph", "bulletList", "paragraph"]);
    expectValid(r);
  });

  it("refuses unsafe links and remote images in block HTML", () => {
    const r = importMarkdown('<p><a href="javascript:x">l</a></p>\n\n<img src="https://e.test/a.png" alt="r">\n');
    expect(codes(r)).toEqual(["unsafe-link", "remote-image", "no-headings"]);
    expectValid(r);
  });

  it("reads <u>, small caps, <sup> and <sub> pairs as marks, across emphasis", () => {
    const [p] = body('a <u>b</u> <span class="small-caps">c</span> x<sup>2</sup> H<sub>2</sub>O <u>**d**</u>');
    expect(p).toEqual({
      type: "paragraph",
      content: [
        { type: "text", text: "a " },
        { type: "text", text: "b", marks: [mark("underline")] },
        { type: "text", text: " " },
        { type: "text", text: "c", marks: [mark("smallCaps")] },
        { type: "text", text: " x" },
        { type: "text", text: "2", marks: [mark("superscript")] },
        { type: "text", text: " H" },
        { type: "text", text: "2", marks: [mark("subscript")] },
        { type: "text", text: "O " },
        { type: "text", text: "d", marks: [mark("bold"), mark("underline")] },
      ],
    });
    expect(codes(importMarkdown("<u>x</u>"))).not.toContain("html");
  });

  it("keeps anything else, and unpaired mark tags, as literal text with an html warning", () => {
    for (const md of ["a <u>b", "a </u> b", 'a <span class="other">b</span>', "a <mark>b</mark>", "<u>a</sup>", "x <br> y"]) {
      const r = importMarkdown(md);
      expect(codes(r), md).toContain("html");
      expect(JSON.stringify(r.chapters[0]!.doc), md).toContain("<");
      expectValid(r);
    }
  });
});
