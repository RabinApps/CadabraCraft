import { describe, expect, it } from "vitest";
import { importDocx } from "..";
import { NUMBERING, PNG, expectValid, makeDocx, para, run } from "./helpers";

const codes = (r: ReturnType<typeof importDocx>) => r.warnings.map((w) => w.code);
const w = (r: ReturnType<typeof importDocx>, code: string) =>
  r.warnings.find((x) => x.code === code);

describe("importDocx", () => {
  it("maps headings, normal paragraphs and splits chapters", () => {
    const r = importDocx(
      makeDocx({
        body:
          para("One", "Heading1") +
          para("Body") +
          para("Sub", "Heading2") +
          para("Two", "Heading1") +
          para("More"),
      }),
    );
    expect(r.chapters.map((c) => c.title)).toEqual(["One", "Two"]);
    expect(r.chapters[0]!.doc.content.map((n) => n.type)).toEqual([
      "heading",
      "paragraph",
      "heading",
    ]);
    expect(r.warnings).toEqual([]);
    expectValid(r);
  });

  it("clamps Heading 4 and follows basedOn for custom heading styles", () => {
    const r = importDocx(makeDocx({ body: para("Ch", "MyChapter") + para("Deep", "Heading4") }));
    expect(r.chapters[0]!.title).toBe("Ch");
    expect(r.chapters[0]!.doc.content[1]).toMatchObject({ type: "heading", attrs: { level: 3 } });
    expect(codes(r)).toEqual(["heading-clamped"]);
    expectValid(r);
  });

  it("reports unknown styles that fall back to Normal", () => {
    const r = importDocx(
      makeDocx({ body: para("A", "Heading1") + para("x", "Weird") + para("y", "Weird") }),
    );
    expect(w(r, "style-fallback")).toMatchObject({ count: 2, examples: ["Weird Style"] });
    expectValid(r);
  });

  it("maps bold, italic, underline, small caps and character styles", () => {
    const body =
      '<w:p><w:r><w:rPr><w:b/><w:i/><w:u w:val="single"/><w:smallCaps/></w:rPr><w:t>all</w:t></w:r>' +
      '<w:r><w:rPr><w:rStyle w:val="Strong"/></w:rPr><w:t>strong</w:t></w:r><w:r><w:rPr><w:b w:val="0"/></w:rPr><w:t>plain</w:t></w:r></w:p>';
    const r = importDocx(makeDocx({ body: para("T", "Heading1") + body }));
    const p = r.chapters[0]!.doc.content[1] as {
      content: { text: string; marks?: { type: string }[] }[];
    };
    expect(p.content[0]!.marks!.map((m) => m.type).sort()).toEqual([
      "bold",
      "italic",
      "smallCaps",
      "underline",
    ]);
    expect(p.content[1]!.marks).toEqual([{ type: "bold" }]);
    expect(p.content[2]!.marks).toBeUndefined();
    expectValid(r);
  });

  it("maps quotes and Quote paragraphs merge into one blockquote", () => {
    const r = importDocx(
      makeDocx({
        body: para("T", "Heading1") + para("a", "Quote") + para("b", "Quote") + para("c"),
      }),
    );
    expect(r.chapters[0]!.doc.content.map((n) => n.type)).toEqual([
      "heading",
      "blockquote",
      "paragraph",
    ]);
    expectValid(r);
  });

  it("merges consecutive Code paragraphs into one code block and ignores fonts", () => {
    const mono = '<w:rFonts w:ascii="Courier New"/>';
    const body =
      para("T", "Heading1") +
      para("before") +
      para("let a = 1;", "SourceCode") +
      para("", "SourceCode") +
      para("  b(&lt;x&gt;);", "MyCode") +
      '<w:p><w:pPr><w:pStyle w:val="SourceCode"/></w:pPr><w:r><w:t>one</w:t></w:r><w:r><w:br/></w:r><w:r><w:t>two</w:t></w:r></w:p>' +
      para("after") +
      `<w:p>${run("only monospace", mono)}</w:p>`;
    const r = importDocx(makeDocx({ body }));
    const c = r.chapters[0]!.doc.content;
    expect(c.map((n) => n.type)).toEqual([
      "heading",
      "paragraph",
      "codeBlock",
      "paragraph",
      "paragraph",
    ]);
    expect(c[2]).toEqual({
      type: "codeBlock",
      content: [{ type: "text", text: "let a = 1;\n\n  b(<x>);\none\ntwo" }],
    });
    expect(r.warnings.map((w) => w.code)).not.toContain("style-fallback");
    expectValid(r);
  });

  it("maps style-based and numbering-based lists with nesting", () => {
    const num = (id: number, lvl: number, t: string) =>
      para(t, undefined, `<w:numPr><w:ilvl w:val="${lvl}"/><w:numId w:val="${id}"/></w:numPr>`);
    const body =
      para("T", "Heading1") +
      para("b1", "ListBullet") +
      para("b2", "ListBullet") +
      num(2, 0, "n1") +
      num(2, 1, "n1a") +
      num(2, 0, "n2") +
      num(1, 0, "dot") +
      num(2, 3, "jump");
    const r = importDocx(makeDocx({ body, numbering: NUMBERING }));
    const c = r.chapters[0]!.doc.content;
    // the trailing level-3 ordered item can only nest one level under the preceding bullet
    expect(c.map((n) => n.type)).toEqual(["heading", "bulletList", "orderedList", "bulletList"]);
    expect(JSON.stringify(c[3])).toContain("jump");
    const ol = c[2] as { content: { content: { type: string }[] }[] };
    expect(ol.content[0]!.content.map((n) => n.type)).toEqual(["paragraph", "orderedList"]);
    expectValid(r);
  });

  it("converts hyperlinks, field hyperlinks and refuses unsafe schemes", () => {
    const rels =
      '<Relationship Id="rId5" Type="x/hyperlink" Target="https://example.com/a" TargetMode="External"/><Relationship Id="rId6" Type="x/hyperlink" Target="javascript:alert(1)" TargetMode="External"/>';
    const body =
      para("T", "Heading1") +
      `<w:p><w:hyperlink r:id="rId5"><w:r><w:rPr><w:rStyle w:val="Hyperlink"/></w:rPr><w:t>site</w:t></w:r></w:hyperlink>` +
      `<w:hyperlink r:id="rId6"><w:r><w:t>bad</w:t></w:r></w:hyperlink><w:hyperlink w:anchor="bm"><w:r><w:t>int</w:t></w:r></w:hyperlink>` +
      `<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText> HYPERLINK "mailto:a@b.co" </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>mail</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r></w:p>`;
    const r = importDocx(makeDocx({ body, rels }));
    const json = JSON.stringify(r.chapters[0]!.doc);
    expect(json).toContain('"href":"https://example.com/a"');
    expect(json).toContain('"href":"mailto:a@b.co"');
    expect(json).not.toContain("javascript");
    expect(json).not.toContain("underline");
    expect(codes(r)).toEqual(expect.arrayContaining(["unsafe-link", "internal-link"]));
    expectValid(r);
  });

  it("imports footnotes", () => {
    const body =
      para("T", "Heading1") +
      '<w:p><w:r><w:t>Hello</w:t></w:r><w:r><w:footnoteReference w:id="2"/></w:r><w:r><w:t>.</w:t></w:r></w:p>';
    const footnotes =
      '<w:footnote w:type="separator" w:id="-1"><w:p><w:r><w:separator/></w:r></w:p></w:footnote>' +
      '<w:footnote w:id="2"><w:p><w:r><w:footnoteRef/></w:r><w:r><w:t xml:space="preserve"> The note.</w:t></w:r></w:p></w:footnote>';
    const r = importDocx(makeDocx({ body, footnotes }));
    const p = r.chapters[0]!.doc.content[1] as {
      content: { type: string; content?: { text: string }[] }[];
    };
    expect(p.content.map((n) => n.type)).toEqual(["text", "footnote", "text"]);
    expect(p.content[1]!.content![0]!.text).toBe("The note.");
    expect(r.warnings).toEqual([]);
    expectValid(r);
  });

  it("only turns centered * * * or # paragraphs into scene breaks", () => {
    const c = '<w:jc w:val="center"/>';
    const body =
      para("T", "Heading1") +
      para("* * *", undefined, c) +
      para("#", undefined, c) +
      para("* * *") +
      '<w:p><w:r><w:br w:type="page"/></w:r></w:p>' +
      "<w:p><w:pPr><w:sectPr/></w:pPr><w:r><w:t>end of section</w:t></w:r></w:p>";
    const r = importDocx(makeDocx({ body }));
    expect(r.chapters[0]!.doc.content.map((n) => n.type)).toEqual([
      "heading",
      "sceneBreak",
      "sceneBreak",
      "paragraph",
      "paragraph",
    ]);
    expect(w(r, "page-break")).toMatchObject({ severity: "info", count: 1 });
    expect(w(r, "section-break")).toMatchObject({ severity: "info", count: 1 });
    expectValid(r);
  });

  it("extracts images into assets with bytes and reports unsupported ones", () => {
    const img = (rid: string, alt: string) =>
      `<w:p><w:r><w:drawing><wp:inline><wp:docPr id="1" name="p" descr="${alt}"/><a:graphic><a:graphicData><a:blip r:embed="${rid}"/></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`;
    const rels =
      '<Relationship Id="rId1" Type="x/image" Target="media/image1.png"/><Relationship Id="rId2" Type="x/image" Target="media/image2.emf"/><Relationship Id="rId3" Type="x/image" Target="media/gone.png"/>';
    const r = importDocx(
      makeDocx({
        body: para("T", "Heading1") + img("rId1", "a cat") + img("rId2", "x") + img("rId3", "y"),
        rels,
        media: { "image1.png": PNG, "image2.emf": new Uint8Array(4) },
      }),
    );
    expect(r.assets).toHaveLength(1);
    expect(r.assets[0]).toMatchObject({
      sourcePath: "word/media/image1.png",
      targetPath: "assets/image1.png",
      mediaType: "image/png",
    });
    expect(Array.from(r.assets[0]!.bytes!)).toEqual(Array.from(PNG));
    expect(r.chapters[0]!.doc.content[1]).toMatchObject({
      type: "image",
      attrs: { src: "assets/image1.png", alt: "a cat" },
    });
    expect(codes(r)).toEqual(expect.arrayContaining(["unsupported-image-format", "missing-image"]));
    expectValid(r);
  });

  it("imports tables as table nodes, flattening merges and nested content with warnings", () => {
    const p = (t: string) => `<w:p><w:r><w:t>${t}</w:t></w:r></w:p>`;
    const tc = (inner: string, pr = "") =>
      `<w:tc>${pr ? `<w:tcPr>${pr}</w:tcPr>` : ""}${inner}</w:tc>`;
    const plain = `<w:tbl><w:tr><w:trPr><w:tblHeader/></w:trPr>${tc(p("H1"))}${tc(p("H2"))}</w:tr><w:tr>${tc(p("a") + p("a2"))}${tc(p("b"))}</w:tr></w:tbl>`;
    const r = importDocx(makeDocx({ body: para("T", "Heading1") + plain }));
    expect(codes(r)).not.toContain("table");
    expect(codes(r)).not.toContain("table-merged");
    const t = JSON.stringify(r.chapters[0]!.doc.content[1]);
    expect(t).toContain('"type":"tableHeader"');
    expect(t).toContain('"text":"a2"');
    expectValid(r);

    const messy =
      `<w:tbl><w:tr>${tc(p("wide"), '<w:gridSpan w:val="2"/>')}</w:tr>` +
      `<w:tr>${tc(p("top"), '<w:vMerge w:val="restart"/>')}${tc(p("x"))}</w:tr>` +
      `<w:tr>${tc("<w:p/>", "<w:vMerge/>")}${tc(`<w:tbl><w:tr>${tc(p("n1"))}${tc(p("n2"))}</w:tr></w:tbl>${p("after")}`)}</w:tr></w:tbl>`;
    const m = importDocx(makeDocx({ body: para("T", "Heading1") + messy }));
    expect(codes(m)).toEqual(expect.arrayContaining(["table-merged", "table-complex"]));
    const tbl = m.chapters[0]!.doc.content[1] as unknown as { content: { content: unknown[] }[] };
    expect(tbl.content.map((row) => row.content.length)).toEqual([2, 2, 2]);
    expect(JSON.stringify(tbl)).toContain("n1 | n2");
    expectValid(m);
  });

  it("reports unsupported features with counts and examples", () => {
    const tbl = (t: string) =>
      `<w:tbl><w:tr><w:tc><w:p><w:r><w:t>${t}</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>b</w:t></w:r></w:p></w:tc></w:tr></w:tbl>`;
    const body =
      para("T", "Heading1") +
      tbl("cell1") +
      tbl("cell2") +
      '<w:p><w:r><w:drawing><wp:inline><a:graphic><a:graphicData><wps:txbx xmlns:wps="x"><w:txbxContent><w:p><w:r><w:t>boxed</w:t></w:r></w:p></w:txbxContent></wps:txbx></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>' +
      '<w:p><w:ins w:id="1"><w:r><w:t>added</w:t></w:r></w:ins><w:del w:id="2"><w:r><w:delText>removed</w:delText></w:r></w:del><w:commentRangeStart w:id="0"/><w:r><w:commentReference w:id="0"/></w:r></w:p>' +
      "<w:p><m:oMath><m:r><m:t>x=1</m:t></m:r></m:oMath></w:p>" +
      "<w:p><w:r><w:rPr><w:strike/></w:rPr><w:t>struck</w:t></w:r></w:p>";
    const r = importDocx(
      makeDocx({
        body,
        comments: '<w:comment w:id="0"><w:p><w:r><w:t>c</w:t></w:r></w:p></w:comment>',
        header: "<w:p><w:r><w:t>Running head</w:t></w:r></w:p>",
      }),
    );
    expect(w(r, "table")).toBeUndefined();
    expect(w(r, "text-box")).toMatchObject({ examples: ["boxed"] });
    expect(w(r, "tracked-changes")).toMatchObject({ count: 2 });
    expect(w(r, "comments")).toBeDefined();
    expect(w(r, "equation")).toMatchObject({ examples: ["x=1"] });
    expect(w(r, "header-footer")).toMatchObject({ examples: ["Running head"] });
    expect(w(r, "unsupported-formatting")).toBeUndefined();
    const text = JSON.stringify(r.chapters[0]!.doc);
    for (const s of ["cell1", "added", "x=1", "struck"]) expect(text).toContain(s);
    expect(text).toContain('"marks":[{"type":"strike"}]');
    expect(text).not.toContain("removed");
    expectValid(r);
  });

  it("splits manual line breaks into paragraphs", () => {
    const r = importDocx(
      makeDocx({
        body: para("T", "Heading1") + "<w:p><w:r><w:t>a</w:t><w:br/><w:t>b</w:t></w:r></w:p>",
      }),
    );
    expect(r.chapters[0]!.doc.content).toHaveLength(3);
    expect(codes(r)).toContain("line-break");
    expectValid(r);
  });

  it("content before first heading becomes Untitled with a warning", () => {
    const r = importDocx(makeDocx({ body: para("preface") + para("One", "Heading1") + run("") }));
    expect(r.chapters.map((c) => c.title)).toEqual(["Untitled", "One"]);
    expect(codes(r)).toContain("untitled-content");
  });

  it("empty document yields no chapters and a warning", () => {
    const r = importDocx(makeDocx({ body: "" }));
    expect(r.chapters).toEqual([]);
    expect(codes(r)).toEqual(["empty-input"]);
  });
});
