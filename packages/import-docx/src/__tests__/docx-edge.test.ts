import type { DocNode } from "@cadabracraft/shared";
import { strToU8, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { ImportError, importDocx } from "..";
import { AssetRegistry } from "../common";
import { parseNumbering } from "../docx/numbering";
import { parseStyles } from "../docx/styles";
import { BodyBuilder } from "../docx/body";
import type { DCtx } from "../docx/types";
import { MAX_XML_DEPTH, descendants, rawText, tagOf, type XNode } from "../docx/xml";
import { NUMBERING, PNG, STYLES, expectValid, makeDocx, para, run } from "./helpers";

type Result = ReturnType<typeof importDocx>;
const codes = (r: Result) => r.warnings.map((w) => w.code);
const warning = (r: Result, code: string) => r.warnings.find((x) => x.code === code);
const T = para("T", "Heading1");
const withStyles = (extra: string) => STYLES.replace("</w:styles>", `${extra}</w:styles>`);
const xmlPart = (xml: string) => strToU8(`<?xml version="1.0"?>${xml}`);
const doc = (body: string, parts: Parameters<typeof makeDocx>[0] = { body: "" }) =>
  importDocx(makeDocx({ ...parts, body: T + body }));
const altOf = (n: DocNode) => (n as { attrs?: { alt?: unknown } }).attrs?.alt;
const content = (r: Result) => r.chapters[0]!.doc.content;
const json = (x: unknown) => JSON.stringify(x);
const errCode = (fn: () => unknown): string | undefined => {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(ImportError);
    return (e as ImportError).code;
  }
  return undefined;
};
const drawingOf = (inner: string, docPr = "") =>
  `<w:p><w:r><w:drawing><wp:inline>${docPr}<a:graphic><a:graphicData>${inner}</a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`;
const blip = (rid?: string) => `<a:blip${rid ? ` r:embed="${rid}"` : ""}/>`;
const rel = (id: string, target: string, external = false) =>
  `<Relationship Id="${id}" Type="x/image" Target="${target}"${external ? ' TargetMode="External"' : ""}/>`;

describe("docx archive and package edge cases", () => {
  it("rechecks the real decompressed size when an entry lies about its size", () => {
    const zip = zipSync(
      {
        "word/document.xml": strToU8("<w:document><w:body/></w:document>"),
        "word/media/big.png": new Uint8Array(1000),
      },
      { level: 0 },
    );
    const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
    for (let i = 0; i <= zip.length - 46; i++)
      if (view.getUint32(i, true) === 0x02014b50) view.setUint32(i + 24, 1, true);
    expect(errCode(() => importDocx(zip, { maxDecompressedBytes: 500 }))).toBe("archive-too-large");
  });

  it("ignores external and missing document relationships and falls back to word/document.xml", () => {
    const rels = (target: string, external = "") =>
      xmlPart(
        `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="x/officeDocument" Target="${target}"${external}/></Relationships>`,
      );
    for (const extra of [
      { "_rels/.rels": rels("https://x.test/document.xml", ' TargetMode="External"') },
      { "_rels/.rels": rels("other/document.xml") },
    ]) {
      const r = doc(para("body"), { body: "", extra });
      expect(r.chapters).toHaveLength(1);
    }
  });

  it("refuses a document part with no w:document root or no body", () => {
    expect(
      errCode(() =>
        importDocx(makeDocx({ body: "", extra: { "word/document.xml": xmlPart("<other/>") } })),
      ),
    ).toBe("missing-document");
    expect(
      errCode(() =>
        importDocx(
          makeDocx({
            body: "",
            extra: { "word/document.xml": xmlPart("<w:document><w:x/></w:document>") },
          }),
        ),
      ),
    ).toBe("missing-document");
  });

  it("tolerates comments, footnotes, relationships and numbering parts without their root element", () => {
    const r = doc(para("body"), {
      body: "",
      extra: {
        "word/comments.xml": xmlPart("<other/>"),
        "word/footnotes.xml": xmlPart("<other/>"),
        "word/endnotes.xml": xmlPart("<other/>"),
        "word/numbering.xml": xmlPart("<other/>"),
        "word/_rels/document.xml.rels": xmlPart("<other/>"),
      },
    });
    expect(r.chapters).toHaveLength(1);
    expect(codes(r)).not.toContain("comments");
  });

  it("skips relationships without an id or target and resolves odd targets", () => {
    const img = (rid: string) => drawingOf(blip(rid));
    const rels =
      '<Relationship Target="media/x.png"/><Relationship Id="rIdX"/>' +
      rel("rId1", "/word/media/image1.png") +
      rel("rId2", "./media//image2.png") +
      rel("rId3", "../word/media/image3.png");
    const r = doc(img("rId1") + img("rId2") + img("rId3") + img("rIdX"), {
      body: "",
      rels,
      media: { "image1.png": PNG, "image2.png": PNG, "image3.png": PNG },
    });
    expect(r.assets.map((a) => a.targetPath)).toEqual([
      "assets/image1.png",
      "assets/image2.png",
      "assets/image3.png",
    ]);
    expect(warning(r, "missing-image")).toMatchObject({ examples: ["rIdX"] });
  });

  it("reports headers and footers and tolerates empty ones", () => {
    const r = doc(para("body"), {
      body: "",
      header: "<w:p><w:r><w:t>Head</w:t></w:r></w:p>",
      extra: { "word/footer1.xml": xmlPart("<w:ftr><w:p/></w:ftr>") },
    });
    expect(warning(r, "header-footer")).toMatchObject({ count: 1, examples: ["Head"] });
  });

  it("counts comment references even without a comments part", () => {
    const r = doc('<w:p><w:r><w:t>a</w:t></w:r><w:r><w:commentReference w:id="1"/></w:r></w:p>');
    expect(warning(r, "comments")).toBeDefined();
  });
});

describe("docx styles and numbering parsing", () => {
  it("copes with missing parts and malformed style and numbering entries", () => {
    expect(parseStyles(undefined).size).toBe(0);
    expect(parseNumbering(undefined).nums.size).toBe(0);
    const styles = parseStyles([
      {
        styles: [
          { style: [], ":@": { "@_type": "paragraph" } },
          { style: [], ":@": { "@_styleId": "Bare" } },
        ],
      },
    ]);
    expect([...styles.keys()]).toEqual(["Bare"]);
    expect(styles.get("Bare")).toMatchObject({ type: "paragraph", name: "Bare" });
  });

  it("reads style-level numbering, including through basedOn and without a level", () => {
    const styles = withStyles(
      '<w:style w:type="paragraph" w:styleId="NumStyle"><w:name w:val="Num Style"/><w:pPr><w:numPr><w:ilvl w:val="1"/><w:numId w:val="2"/></w:numPr></w:pPr></w:style>' +
        '<w:style w:type="paragraph" w:styleId="NumChild"><w:name w:val="Num Child"/><w:basedOn w:val="NumStyle"/></w:style>' +
        '<w:style w:type="paragraph" w:styleId="NumBare"><w:name w:val="Num Bare"/><w:pPr><w:numPr/></w:pPr></w:style>' +
        '<w:style w:type="paragraph" w:styleId="NumNoLvl"><w:name w:val="Num No Level"/><w:pPr><w:numPr><w:numId w:val="2"/></w:numPr></w:pPr></w:style>' +
        '<w:style w:type="paragraph"><w:name w:val="no id"/></w:style>' +
        '<w:style w:styleId="NoType"/>',
    );
    const r = doc(
      para("a", "NumStyle") +
        para("b", "NumChild") +
        para("c", "NumBare") +
        para("d", "NumNoLvl") +
        para("e", "NoType") +
        para("f", "Nope"),
      { body: "", styles, numbering: NUMBERING },
    );
    expect(content(r).map((n) => n.type)).toEqual([
      "heading",
      "orderedList",
      "paragraph",
      "orderedList",
      "paragraph",
      "paragraph",
    ]);
    // examples are capped at five; the unknown style id "Nope" is the sixth fallback
    expect(warning(r, "style-fallback")).toMatchObject({ count: 6 });
    expect(warning(r, "style-fallback")!.examples).toEqual(
      expect.arrayContaining(["Num Bare", "NoType"]),
    );
    expectValid(r);
  });

  it("maps numbered and bulleted list styles with a level suffix and nested styles", () => {
    const styles = withStyles(
      '<w:style w:type="paragraph" w:styleId="LB2"><w:name w:val="List Bullet 2"/></w:style>' +
        '<w:style w:type="paragraph" w:styleId="LN3"><w:name w:val="List Number 3"/></w:style>',
    );
    const r = doc(
      para("zero", "ListNumber") +
        para("one", "ListBullet") +
        para("two", "LB2") +
        para("three", "LN3") +
        para("plain", "Normal"),
      {
        body: "",
        styles,
      },
    );
    // "List Number 3" only nests one level under the bullet list before it
    expect(content(r).map((n) => n.type)).toEqual([
      "heading",
      "orderedList",
      "bulletList",
      "paragraph",
    ]);
    expect(json(content(r)[2])).toContain('"type":"orderedList"');
    expect(codes(r)).not.toContain("style-fallback");
    expectValid(r);
  });

  it("reads numbering definitions with missing ids, formats and levels", () => {
    const numbering =
      '<?xml version="1.0"?><w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
      '<w:abstractNum><w:lvl w:ilvl="0"><w:numFmt w:val="decimal"/></w:lvl></w:abstractNum>' +
      '<w:abstractNum w:abstractNumId="5"><w:lvl><w:numFmt/></w:lvl><w:lvl w:ilvl="1"/></w:abstractNum>' +
      '<w:num/><w:num w:numId="9"/>' +
      '<w:num w:numId="7"><w:abstractNumId w:val="5"/></w:num>' +
      '<w:num w:numId="8"><w:abstractNumId/></w:num></w:numbering>';
    const np = (id: string, lvl?: number) =>
      para(
        "x",
        undefined,
        `<w:numPr>${lvl === undefined ? "" : `<w:ilvl w:val="${lvl}"/>`}<w:numId w:val="${id}"/></w:numPr>`,
      );
    const r = doc(np("7") + np("7", 1) + np("0") + np("9") + np("8"), { body: "", numbering });
    // numId 9 and 8 point at no abstract numbering, so they become bullets
    expect(content(r).map((n) => n.type)).toEqual([
      "heading",
      "orderedList",
      "paragraph",
      "bulletList",
    ]);
    expectValid(r);
  });

  it("uses a style numId when the paragraph has numPr with only a level", () => {
    const styles = withStyles(
      '<w:style w:type="paragraph" w:styleId="NumStyle"><w:name w:val="Num Style"/><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr></w:style>',
    );
    const r = doc(
      para("a", "NumStyle", '<w:numPr><w:ilvl w:val="0"/></w:numPr>') +
        para("b", undefined, '<w:numPr><w:ilvl w:val="1"/></w:numPr>'),
      { body: "", styles, numbering: NUMBERING },
    );
    expect(content(r).map((n) => n.type)).toEqual(["heading", "bulletList", "paragraph"]);
  });
});

describe("docx xml helpers", () => {
  it("handles attribute-only nodes, missing text and excessive depth", () => {
    expect(tagOf({ ":@": { "@_a": "1" } })).toBeUndefined();
    expect(tagOf({ ":@": { "@_a": "1" }, p: [] })).toBe("p");
    expect(rawText({ p: [{ "#text": undefined }, { t: [{ x: [] }] }, { tab: [] }] })).toBe(" ");
    let deep: XNode = { t: [{ "#text": "x" }] };
    for (let i = 0; i < 150; i++) deep = { x: [deep] };
    expect(rawText(deep)).toBe("");
    expect(descendants(deep, "t")).toEqual([]);
  });
});

describe("docx body edge cases", () => {
  it("keeps empty code paragraphs and code paragraphs that hold footnotes or images", () => {
    const footnotes = '<w:footnote w:id="2"><w:p><w:r><w:t>n</w:t></w:r></w:p></w:footnote>';
    const code = (inner: string) =>
      `<w:p><w:pPr><w:pStyle w:val="SourceCode"/></w:pPr>${inner}</w:p>`;
    const r = doc(
      code("") +
        para("plain") +
        code('<w:r><w:t>see</w:t></w:r><w:r><w:footnoteReference w:id="2"/></w:r>') +
        code(`<w:r><w:drawing><wp:inline><a:blip r:embed="rId1"/></wp:inline></w:drawing></w:r>`),
      { body: "", footnotes, rels: rel("rId1", "media/a.png"), media: { "a.png": PNG } },
    );
    expect(content(r).map((n) => n.type)).toEqual([
      "heading",
      "codeBlock",
      "paragraph",
      "paragraph",
      "image",
    ]);
    expect(content(r)[1]).toEqual({ type: "codeBlock" });
    expectValid(r);
  });

  it("drops empty headings and empty list items, keeps footnote-only headings and lifts images out of headings", () => {
    const footnotes = '<w:footnote w:id="2"><w:p><w:r><w:t>n</w:t></w:r></w:p></w:footnote>';
    const r = doc(
      para("", "Heading2") +
        '<w:p><w:pPr><w:pStyle w:val="Heading2"/></w:pPr><w:r><w:footnoteReference w:id="2"/></w:r></w:p>' +
        '<w:p><w:pPr><w:pStyle w:val="Heading2"/></w:pPr><w:r><w:t>with image</w:t></w:r><w:r><w:drawing><wp:inline><a:blip r:embed="rId1"/></wp:inline></w:drawing></w:r></w:p>' +
        para("", "ListBullet") +
        para("kept", "ListBullet"),
      { body: "", footnotes, rels: rel("rId1", "media/a.png"), media: { "a.png": PNG } },
    );
    expect(content(r).map((n) => n.type)).toEqual([
      "heading",
      "heading",
      "heading",
      "image",
      "bulletList",
    ]);
    expectValid(r);
  });

  it("keeps a normal paragraph that holds only a footnote", () => {
    const footnotes = '<w:footnote w:id="2"><w:p><w:r><w:t>n</w:t></w:r></w:p></w:footnote>';
    const r = doc('<w:p><w:r><w:footnoteReference w:id="2"/></w:r></w:p>', {
      body: "",
      footnotes,
    });
    expect(json(content(r)[1])).toContain('"type":"footnote"');
  });

  it("reports page-break-before and ignores numId 0", () => {
    const r = doc(
      para("a", undefined, "<w:pageBreakBefore/>") +
        para("b", undefined, '<w:numPr><w:numId w:val="0"/></w:numPr>') +
        para("c", undefined, '<w:pageBreakBefore w:val="0"/>'),
      { body: "", numbering: NUMBERING },
    );
    expect(warning(r, "page-break")).toMatchObject({ count: 1 });
    expect(content(r).map((n) => n.type)).toEqual([
      "heading",
      "paragraph",
      "paragraph",
      "paragraph",
    ]);
  });

  it("handles tables without rows or a header marker, and structured document tags at body level", () => {
    const p = (t: string) => `<w:p><w:r><w:t>${t}</w:t></w:r></w:p>`;
    const r = doc(
      "<w:tbl/>" +
        `<w:tbl><w:tr><w:trPr/><w:tc>${p("c")}</w:tc></w:tr></w:tbl>` +
        `<w:sdt><w:sdtContent>${p("in sdt")}</w:sdtContent></w:sdt>` +
        "<w:sdt/>" +
        `<w:sdtContent>${p("bare content")}</w:sdtContent>` +
        `<w:customXml>${p("in custom")}</w:customXml>` +
        `<w:ins w:id="1">${p("inserted")}</w:ins>` +
        `<w:del w:id="2">${p("deleted")}</w:del>` +
        `<w:moveFrom w:id="3">${p("moved")}</w:moveFrom>`,
    );
    const text = json(r.chapters[0]!.doc);
    for (const s of ["in sdt", "bare content", "in custom", "inserted"]) expect(text).toContain(s);
    expect(text).not.toContain("deleted");
    expect(text).not.toContain("moved");
    expect(text).not.toContain("tableHeader");
    expect(warning(r, "tracked-changes")).toMatchObject({ count: 2 });
    expectValid(r);
  });

  it("stops descending past the maximum depth (the XML parser itself refuses more than 100 nested tags)", () => {
    const builder = new BodyBuilder({} as DCtx, 8);
    builder.walk([{ p: [] }], MAX_XML_DEPTH + 1);
    expect(builder.out).toEqual([]);
  });
});

describe("docx run edge cases", () => {
  it("maps character styles by name and by properties, and sub/superscript, strike and underline off", () => {
    const styles = withStyles(
      '<w:style w:type="character" w:styleId="Emph"><w:name w:val="Emphasis"/></w:style>' +
        '<w:style w:type="character" w:styleId="Strong2"><w:name w:val="strong"/></w:style>' +
        '<w:style w:type="character" w:styleId="Fancy"><w:name w:val="Fancy"/><w:rPr><w:b/><w:i/><w:u w:val="single"/><w:smallCaps/></w:rPr></w:style>',
    );
    const r = (rpr: string) => {
      const out = doc(`<w:p>${run("x", rpr)}</w:p>`, { body: "", styles });
      return (
        (content(out)[1] as { content: { marks?: { type: string }[] }[] }).content[0]!.marks ?? []
      )
        .map((m) => m.type)
        .sort();
    };
    expect(r('<w:rStyle w:val="Emph"/>')).toEqual(["italic"]);
    expect(r('<w:rStyle w:val="Strong2"/>')).toEqual(["bold"]);
    expect(r('<w:rStyle w:val="Fancy"/>')).toEqual(["bold", "italic", "smallCaps", "underline"]);
    expect(r('<w:vertAlign w:val="superscript"/>')).toEqual(["superscript"]);
    expect(r('<w:vertAlign w:val="subscript"/>')).toEqual(["subscript"]);
    expect(r('<w:vertAlign w:val="baseline"/>')).toEqual([]);
    expect(r('<w:u w:val="none"/><w:i w:val="0"/><w:smallCaps w:val="0"/>')).toEqual([]);
    expect(r("<w:dstrike/>")).toEqual(["strike"]);
    expect(r('<w:rStyle w:val="Fancy"/><w:b w:val="0"/>')).toEqual([
      "italic",
      "smallCaps",
      "underline",
    ]);
  });

  it("skips hidden text, converts tabs, no-break hyphens and carriage returns, and ignores page breaks", () => {
    const r = doc(
      `<w:p><w:r><w:rPr><w:vanish/></w:rPr><w:t>secret</w:t></w:r><w:r><w:t>a</w:t><w:tab/><w:t>b</w:t><w:noBreakHyphen/><w:t>c</w:t><w:cr/><w:t>d</w:t><w:br w:type="column"/><w:br w:type="textWrapping"/><w:t>e</w:t><w:sym w:char="1"/></w:r></w:p>`,
    );
    const text = json(r.chapters[0]!.doc);
    expect(text).not.toContain("secret");
    expect(text).toContain("a b-c");
    expect(warning(r, "hidden-text")).toMatchObject({ severity: "info", examples: ["secret"] });
    expect(warning(r, "page-break")).toMatchObject({ count: 1 });
    expect(codes(r)).toContain("line-break");
  });

  it("replaces complex fields by their result and keeps hyperlink fields as links", () => {
    const fld = (t: string) => `<w:r><w:fldChar w:fldCharType="${t}"/></w:r>`;
    const instr = (s: string) => `<w:r><w:instrText>${s}</w:instrText></w:r>`;
    const body =
      `<w:p>${fld("begin")}${instr(" PAGE ")}${fld("separate")}${run("3")}${fld("end")}</w:p>` +
      // link field wrapping a nested non-link field and an instruction-phase text that must be dropped
      `<w:p>${fld("begin")}${instr(' HYPERLINK "https://a.test/" ')}${run("dropped")}${fld("separate")}${run("go ")}${fld("begin")}${instr(" NUMPAGES ")}${fld("separate")}${run("9")}${fld("end")}${run(" now")}${fld("end")}</w:p>` +
      // bookmark link field has no quoted target: kept as plain text without a field note
      `<w:p>${fld("begin")}${instr(' HYPERLINK \\l "bm" ')}${fld("separate")}${run("bookmark")}${fld("end")}</w:p>` +
      // unbalanced and odd field characters
      `<w:p>${fld("separate")}${instr("ORPHAN")}${run("orphan")}<w:r><w:fldChar/></w:r><w:r><w:fldChar w:fldCharType="dirty"/></w:r>${fld("end")}</w:p>` +
      // instruction text after the separator is ignored; elements inside text are tolerated
      `<w:p>${fld("begin")}<w:r><w:instrText><w:x/></w:instrText></w:r>${fld("separate")}${instr("late")}<w:r><w:t><w:x/></w:t></w:r>${fld("end")}</w:p>`;
    const r = doc(body);
    const text = json(r.chapters[0]!.doc);
    expect(text).toContain('"href":"https://a.test/"');
    expect(text).not.toContain("dropped");
    expect(text).toContain("bookmark");
    expect(warning(r, "field")).toMatchObject({ examples: ["PAGE", "NUMPAGES"] });
    // the nested NUMPAGES result and the text after it stay inside the link
    expect(text).toMatch(/"text":"go 9 now","marks":\[\{"type":"link"/);
    expectValid(r);
  });

  it("converts simple fields, hyperlinks without targets and internal relationships", () => {
    const rels = '<Relationship Id="rId9" Type="x/hyperlink" Target="#local"/>';
    const body =
      `<w:p><w:fldSimple w:instr=' HYPERLINK "https://s.test/" '><w:r><w:t>simple</w:t></w:r></w:fldSimple>` +
      `<w:fldSimple w:instr=" PAGE "><w:r><w:t>1</w:t></w:r></w:fldSimple>` +
      `<w:fldSimple><w:r><w:t>noinstr</w:t></w:r></w:fldSimple>` +
      `<w:hyperlink><w:r><w:t>nolink</w:t></w:r></w:hyperlink>` +
      `<w:hyperlink r:id="rId9"><w:r><w:t>internalrel</w:t></w:r></w:hyperlink>` +
      `<w:hyperlink r:id="rId404"><w:r><w:t>unknownrel</w:t></w:r></w:hyperlink></w:p>` +
      `<w:p><w:hyperlink r:id="rId5"><w:fldSimple w:instr=" PAGE "><w:r><w:t>inside</w:t></w:r></w:fldSimple></w:hyperlink></w:p>`;
    const r = doc(body, {
      body: "",
      rels:
        rels +
        '<Relationship Id="rId5" Type="x/hyperlink" Target="https://h.test/" TargetMode="External"/>',
    });
    const text = json(r.chapters[0]!.doc);
    expect(text).toContain('"href":"https://s.test/"');
    expect(text).toMatch(
      /"text":"inside","marks":\[\{"type":"link","attrs":\{"href":"https:\/\/h.test\/"/,
    );
    for (const s of ["noinstr", "nolink", "internalrel", "unknownrel"]) expect(text).toContain(s);
    expect(warning(r, "field")).toBeDefined();
    expectValid(r);
  });

  it("handles tracked changes, content controls, smart tags, equations and alternate content inside paragraphs", () => {
    const r = (x: string) => `<w:p>${x}</w:p>`;
    const body =
      r(
        `<w:moveTo w:id="1">${run("moved-in")}</w:moveTo><w:moveFrom w:id="2">${run("moved-out")}</w:moveFrom>`,
      ) +
      r(`<w:sdt><w:sdtContent>${run("sdt-text")}</w:sdtContent></w:sdt><w:sdt/>`) +
      r(`<w:sdtContent>${run("bare-sdt")}</w:sdtContent>`) +
      r(`<w:smartTag>${run("smart")}</w:smartTag><w:customXml>${run("custom")}</w:customXml>`) +
      r(`<w:dir>${run("dir")}</w:dir><w:bdo>${run("bdo")}</w:bdo>`) +
      r(`<m:oMathPara><m:oMath><m:r><m:t>y=2</m:t></m:r></m:oMath></m:oMathPara>`) +
      r(
        `<mc:AlternateContent><mc:Choice>${run("choice")}</mc:Choice><mc:Fallback>${run("fallback")}</mc:Fallback></mc:AlternateContent>`,
      ) +
      r(
        `<mc:AlternateContent><mc:Fallback>${run("only-fallback")}</mc:Fallback></mc:AlternateContent>`,
      ) +
      r(`<mc:AlternateContent/>${run("after-empty")}`) +
      r(
        `<w:r><mc:AlternateContent><mc:Choice>${run("run-choice")}</mc:Choice></mc:AlternateContent></w:r>`,
      ) +
      r(
        `<w:r><mc:AlternateContent><mc:Fallback>${run("run-fallback")}</mc:Fallback></mc:AlternateContent></w:r>`,
      ) +
      r("<w:r><mc:AlternateContent/></w:r>") +
      r("<w:r><w:object/></w:r>");
    const out = doc(body);
    const text = json(out.chapters[0]!.doc);
    for (const s of [
      "moved-in",
      "sdt-text",
      "bare-sdt",
      "smart",
      "custom",
      "dir",
      "bdo",
      "y=2",
      "choice",
      "only-fallback",
      "after-empty",
    ])
      expect(text).toContain(s);
    expect(text).not.toContain("moved-out");
    expect(text).not.toContain('"text":"fallback"');
    expect(codes(out)).toEqual(
      expect.arrayContaining(["tracked-changes", "equation", "embedded-object"]),
    );
    expectValid(out);
  });
});

describe("docx notes edge cases", () => {
  const note = (id: string, inner: string, attrs = "") =>
    `<w:footnote w:id="${id}"${attrs}>${inner}</w:footnote>`;
  const p = (t: string) => `<w:p><w:r><w:t xml:space="preserve">${t}</w:t></w:r></w:p>`;
  const ref = (kind: string, id?: string) =>
    `<w:p><w:r><w:t>x</w:t></w:r><w:r><w:${kind}Reference${id === undefined ? "" : ` w:id="${id}"`}/></w:r></w:p>`;

  it("reports missing and nested note references, and imports endnotes as footnotes", () => {
    const footnotes =
      note("1", p("outer") + '<w:p><w:r><w:footnoteReference w:id="1"/></w:r></w:p>') +
      note("9", p("skipped"), ' w:type="continuationNotice"') +
      "<w:footnote><w:p/></w:footnote>";
    const endnotes = '<w:endnote w:id="4"><w:p><w:r><w:t>end</w:t></w:r></w:p></w:endnote>';
    const r = doc(
      ref("footnote", "1") +
        ref("footnote") +
        ref("footnote", "99") +
        ref("footnote", "9") +
        ref("endnote", "4") +
        ref("endnote", "5"),
      { body: "", footnotes, endnotes },
    );
    expect(codes(r)).toEqual(
      expect.arrayContaining(["footnote-nested", "footnote-missing", "endnote"]),
    );
    expect(warning(r, "footnote-missing")).toMatchObject({ count: 4 });
    expect(json(r.chapters[0]!.doc)).toContain('"text":"end"');
    expectValid(r);
  });

  it("joins multi-paragraph notes and reports tables, images and empty notes", () => {
    const img =
      '<w:p><w:r><w:drawing><wp:inline><a:blip r:embed="rId1"/></wp:inline></w:drawing></w:r></w:p>';
    const footnotes =
      note(
        "1",
        p("first") +
          "<w:p><w:r><w:t>second</w:t><w:br/><w:t>third</w:t></w:r></w:p>" +
          "<w:tbl><w:tr><w:tc><w:p/></w:tc></w:tr></w:tbl>" +
          img,
      ) +
      note("2", p("   ")) +
      note("3", "");
    const r = doc(ref("footnote", "1") + ref("footnote", "2") + ref("footnote", "3"), {
      body: "",
      footnotes,
      rels: rel("rId1", "media/a.png"),
      media: { "a.png": PNG },
    });
    const notes = content(r)
      .slice(1)
      .flatMap((n) => (n as { content: { type: string; content?: { text: string }[] }[] }).content)
      .filter((n) => n.type === "footnote");
    expect(notes[0]!.content![0]!.text.trim()).toBe("first second third");
    expect(notes[1]).toEqual({ type: "footnote" });
    expect(notes[2]).toEqual({ type: "footnote" });
    expect(codes(r)).toEqual(expect.arrayContaining(["note-table", "note-image"]));
    expect(r.assets).toEqual([]);
    expectValid(r);
  });
});

describe("docx drawing edge cases", () => {
  it("reports images that cannot be found and keeps those without alt text", () => {
    const rels =
      rel("rId1", "media/a.png") +
      rel("rId2", "https://x.test/remote.png", true) +
      rel("rId3", "media/a.png");
    const r = doc(
      drawingOf(blip("rId1")) +
        drawingOf(blip("rId1"), '<wp:docPr id="1" name="n"/>') +
        drawingOf(blip("rId1"), '<wp:docPr id="1" name="n" descr="a dog"/>') +
        drawingOf(blip("rId2")) +
        drawingOf(blip()) +
        drawingOf(blip("rId77")),
      { body: "", rels, media: { "a.png": PNG } },
    );
    const images = content(r).filter((n) => n.type === "image");
    expect(images.map(altOf)).toEqual([null, null, "a dog"]);
    expect(r.assets).toHaveLength(1);
    expect(warning(r, "missing-image")).toMatchObject({ count: 3 });
    expect(warning(r, "missing-image")!.examples).toEqual(
      expect.arrayContaining(["rId2", "no relationship", "rId77"]),
    );
  });

  it("reports text boxes next to pictures, and shapes with and without a name", () => {
    const tx = "<w:txbxContent><w:p><w:r><w:t>boxed</w:t></w:r></w:p></w:txbxContent>";
    const r = doc(
      drawingOf(tx + blip("rId1"), '<wp:docPr id="1" name="box"/>') +
        drawingOf("<a:shape/>", '<wp:docPr id="2" name="Chart 1"/>') +
        drawingOf("<a:shape/>"),
      { body: "", rels: rel("rId1", "media/a.png"), media: { "a.png": PNG } },
    );
    expect(warning(r, "text-box")).toMatchObject({ examples: ["boxed"] });
    expect(warning(r, "unsupported-drawing")).toMatchObject({ count: 2, examples: ["Chart 1"] });
    expect(content(r).some((n) => n.type === "image")).toBe(true);
  });

  it("handles legacy VML pictures: images, text boxes and unsupported shapes", () => {
    const pict = (inner: string) => `<w:p><w:r><w:pict>${inner}</w:pict></w:r></w:p>`;
    const r = doc(
      pict('<v:imagedata r:id="rId1" o:title="vml cat"/>') +
        pict('<v:imagedata r:id="rId1"/>') +
        pict(
          "<v:textbox><w:txbxContent><w:p><w:r><w:t>vml box</w:t></w:r></w:p></w:txbxContent></v:textbox>",
        ) +
        pict("<v:shape/>"),
      { body: "", rels: rel("rId1", "media/a.png"), media: { "a.png": PNG } },
    );
    const images = content(r).filter((n) => n.type === "image");
    expect(images.map(altOf)).toEqual(["vml cat", null]);
    expect(warning(r, "text-box")).toMatchObject({ examples: ["vml box"] });
    expect(warning(r, "unsupported-drawing")).toMatchObject({ count: 1 });
  });
});

describe("shared asset registry", () => {
  it("names assets safely, de-duplicates names and omits missing media type and bytes", () => {
    const reg = new AssetRegistry();
    expect(reg.register("...").targetPath).toBe("assets/image");
    expect(reg.register("dir/").targetPath).toBe("assets/image-2");
    expect(reg.register("a/photo").targetPath).toBe("assets/photo");
    expect(reg.register("b/photo").targetPath).toBe("assets/photo-2");
    expect(reg.register("b/photo")).toBe(reg.assets[3]);
    expect(reg.assets[2]).toEqual({ sourcePath: "a/photo", targetPath: "assets/photo" });
    const full = reg.register("c/ph oto.PNG", "image/png", new Uint8Array(1));
    expect(full).toMatchObject({ targetPath: "assets/ph_oto.PNG", mediaType: "image/png" });
    expect(full.bytes).toHaveLength(1);
    expect(reg.register("d/ph_oto.PNG").targetPath).toBe("assets/ph_oto-2.PNG");
  });
});
