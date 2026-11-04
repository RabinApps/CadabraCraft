import { describe, expect, it } from "vitest";
import type { DocNode } from "@cadabracraft/shared";
import { htmlToBlocks, importDocx, importHtml, importMarkdown } from "..";
import { alignOfAttrs, alignOfCss, withAlign } from "../common";
import { NUMBERING, expectValid, makeDocx, para } from "./helpers";

const align = (n: DocNode | undefined): unknown =>
  n && "attrs" in n ? (n.attrs?.textAlign ?? null) : null;
const html = (h: string) => htmlToBlocks(h).blocks.map((n) => [n.type, align(n)]);

describe("text alignment: values", () => {
  it("reads the alignment of a stylesheet or attribute value", () => {
    expect(alignOfCss("text-align: center")).toBe("center");
    expect(alignOfCss("color:red; TEXT-ALIGN : Right")).toBe("end");
    expect(alignOfCss("text-align:left")).toBe("start");
    expect(alignOfCss("text-align:start")).toBe("start");
    expect(alignOfCss("text-align:end")).toBe("end");
    expect(alignOfCss("text-align:justify")).toBeNull();
    expect(alignOfCss("center")).toBe("center");
    expect(alignOfCss("color:red")).toBeNull();
    expect(alignOfCss(undefined)).toBeNull();
  });

  it("prefers our own attribute and class, then style, then the align attribute", () => {
    const at = (a: Record<string, string>) => alignOfAttrs((n) => a[n]);
    expect(at({ "data-text-align": "end", style: "text-align:center" })).toBe("end");
    expect(at({ class: "x align-center y" })).toBe("center");
    expect(at({ class: "align-start" })).toBe("start");
    expect(at({ style: "text-align:right", align: "center" })).toBe("end");
    expect(at({ style: "text-align:justify", align: "center" })).toBe("center");
    expect(at({ align: "left" })).toBe("start");
    expect(at({})).toBeNull();
  });

  it("adds the alignment to a paragraph or heading that has none, and to nothing else", () => {
    const para: DocNode = { type: "paragraph" };
    expect(withAlign(para, "center")).toEqual({
      type: "paragraph",
      attrs: { textAlign: "center" },
    });
    expect(withAlign({ type: "heading", attrs: { level: 2 } }, "end")).toEqual({
      type: "heading",
      attrs: { level: 2, textAlign: "end" },
    });
    const own: DocNode = { type: "paragraph", attrs: { textAlign: "start" } };
    expect(withAlign(own, "center")).toBe(own);
    expect(withAlign(para, null)).toBe(para);
    const code: DocNode = { type: "codeBlock" };
    expect(withAlign(code, "center")).toBe(code);
  });
});

describe("text alignment: HTML", () => {
  it("reads the align attribute, style, our class and data attribute on paragraphs and headings", () => {
    expect(
      html(
        '<p align="center">a</p><p style="text-align: right">b</p><p class="align-end">c</p>' +
          '<h2 data-text-align="center">d</h2><h1 style="text-align:left">e</h1><p style="text-align:justify">f</p><p>g</p>',
      ),
    ).toEqual([
      ["paragraph", "center"],
      ["paragraph", "end"],
      ["paragraph", "end"],
      ["heading", "center"],
      ["heading", "start"],
      ["paragraph", null],
      ["paragraph", null],
    ]);
  });

  it("lets a container, and <center>, align the paragraphs and headings in it that have no alignment of their own", () => {
    expect(
      html(
        '<div align="center"><p>a</p><p align="right">b</p><h2>c</h2></div>' +
          "<center>d<br>e</center><div><p>f</p></div>",
      ),
    ).toEqual([
      ["paragraph", "center"],
      ["paragraph", "end"],
      ["heading", "center"],
      ["paragraph", "center"],
      ["paragraph", "center"],
      ["paragraph", null],
    ]);
  });

  it("aligns the text of a bare container and keeps the document valid", () => {
    const r = importHtml("<h1>One</h1><div style='text-align:center'>middle</div><p>tail</p>");
    expect(r.chapters[0]!.doc.content.map(align)).toEqual([null, "center", null]);
    expectValid(r);
  });
});

describe("text alignment: Markdown", () => {
  const md = (text: string) => {
    const r = importMarkdown(text);
    return r.chapters.flatMap((c) => c.doc.content).map((n) => [n.type, align(n)]);
  };

  it("reads a div align wrapper with Markdown inside", () => {
    expect(
      md(
        '# T\n\n<div align="center">\n\nOne *a*\n\n## Two\n\n</div>\n\nafter\n\n<div align="right">\n\nR\n\n</div>\n',
      ),
    ).toEqual([
      ["heading", null],
      ["paragraph", "center"],
      ["heading", "center"],
      ["paragraph", null],
      ["paragraph", "end"],
    ]);
    expect(md('# T\n\n<div align="left">\n\nL\n\n</div>\n')[1]).toEqual(["paragraph", "start"]);
  });

  it("lets an unclosed wrapper run to the end, and a new one close the one before", () => {
    expect(md('# T\n\n<div align="center">\n\nA\n\nB\n')).toEqual([
      ["heading", null],
      ["paragraph", "center"],
      ["paragraph", "center"],
    ]);
    expect(md('# T\n\n<div align="center">\n\nA\n\n<div align="right">\n\nB\n')).toEqual([
      ["heading", null],
      ["paragraph", "center"],
      ["paragraph", "end"],
    ]);
  });

  it("leaves other HTML to the HTML reader, a stray close tag included", () => {
    expect(md("# T\n\n<div>\n\nA\n\n</div>\n").map((x) => x[1])).toEqual([null, null]);
    expect(md('# T\n\n<div align="justify">\n\nA\n\n</div>\n').map((x) => x[1])).toEqual([
      null,
      null,
    ]);
  });

  it("does not align what is inside a list or a quote", () => {
    const r = md('# T\n\n<div align="center">\n\n> quoted\n\n- item\n\n</div>\n');
    expect(r.map((x) => x[0])).toEqual(["heading", "blockquote", "bulletList"]);
  });
});

describe("text alignment: Word", () => {
  const jc = (v: string) => `<w:jc w:val="${v}"/>`;
  const docx = (body: string) => {
    const r = importDocx(
      makeDocx({ body: para("Chapter", "Heading1") + body, numbering: NUMBERING }),
    );
    expectValid(r);
    return r.chapters[0]!.doc.content;
  };

  it("reads a paragraph's own centre and right, and treats left, start and justified as the style's", () => {
    const out = docx(
      para("c", undefined, jc("center")) +
        para("r", undefined, jc("right")) +
        para("e", undefined, jc("end")) +
        para("l", undefined, jc("left")) +
        para("s", undefined, jc("start")) +
        para("b", undefined, jc("both")) +
        para("n"),
    );
    expect(out.slice(1).map(align)).toEqual(["center", "end", "end", null, null, null, null]);
  });

  it("aligns a heading and the paragraphs of a quote and a list item", () => {
    const out = docx(
      para("Sub", "Heading2", jc("right")) +
        para("q", "Quote", jc("center")) +
        para(
          "li",
          "ListBullet",
          '<w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr>' + jc("right"),
        ),
    );
    expect(out[1]).toMatchObject({ type: "heading", attrs: { level: 2, textAlign: "end" } });
    expect(JSON.stringify(out)).toContain('"textAlign":"center"');
    const list = out.find((n) => n.type === "bulletList")!;
    expect(JSON.stringify(list)).toContain('"textAlign":"end"');
  });

  it("keeps a centred line of asterisks a scene break", () => {
    const out = docx(para("***", undefined, jc("center")));
    expect(out[1]).toMatchObject({ type: "sceneBreak" });
  });
});
