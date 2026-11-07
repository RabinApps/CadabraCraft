import { describe, expect, it } from "vitest";
import type { DocNode, Mark } from "@cadabracraft/shared";
import { buildRtf, type RtfChapter } from "../index";
import { inline, runWords, textRuns } from "../paragraphs";
import { esc, illegalChar } from "../text";
import type { Ctx } from "../types";
import { t, p, chapter, item, m, book, build, one, message, checkRtf } from "./rtfFixtures";

describe("text", () => {
  it("escapes RTF specials and writes everything outside ASCII as \\u units", () => {
    expect(esc("a\\b{c}d")).toBe("a\\\\b\\{c\\}d");
    expect(esc("é—😀")).toBe("\\u233?\\u8212?\\u-10179?\\u-8704?");
    expect(esc("plain")).toBe("plain");
  });
  it("finds characters that cannot be written", () => {
    expect(illegalChar("fine\ttext\n\r")).toBeNull();
    expect(illegalChar("a\u0001b")).toBe("U+0001");
    expect(illegalChar("a\uD800b")).toBe("U+D800");
    expect(illegalChar("a\uDC00b")).toBe("U+DC00");
    expect(illegalChar("ok 😀")).toBeNull();
  });
  it("turns line feeds and tabs into RTF breaks", () => {
    expect(textRuns("a\nb\r\nc\rd\te", "")).toBe("a\\line b\\line c\\line d\\tab e");
    expect(textRuns("", "")).toBe("");
    expect(textRuns("x", "\\b")).toBe("{\\b x}");
  });
});

describe("document", () => {
  const out = one(p(t("Hello world.")));
  it("is a well-formed 7-bit RTF document with the manuscript page setup", () => {
    checkRtf(out);
    expect(out).toContain("\\paperw12240\\paperh15840\\margl1440\\margr1440\\margt1440\\margb1440");
    expect(out).toContain("{\\fonttbl{\\f0\\froman\\fcharset0 Times New Roman;}");
    expect(out).toContain("{\\info{\\title The Long Road}{\\author Ada Lovelace}");
    expect(out).toContain("{\\creatim\\yr2020\\mo1\\dy1\\hr0\\min0}");
  });
  it("writes a title page, a running header with the page field and restarts numbering", () => {
    expect(out).toContain("About 2 words");
    expect(out).toContain("\\b The Long Road");
    expect(out).toContain("by Ada Lovelace");
    expect(out).toContain("Lovelace / THE LONG ROAD / {\\field{\\*\\fldinst{PAGE}}{\\fldrslt 1}}");
    expect(out).toContain("\\pgnrestart\\pgnstarts1");
    expect(out.split("\\sect\n")).toHaveLength(2);
  });
  it("writes paragraphs double spaced with a first-line indent", () => {
    expect(out).toMatch(/\\sl480\\slmult1\\sb0\\sa0\\li0\\ri0\\fi720\\ql Hello world\.\\par/);
  });
  it("is deterministic and honours the modified date", () => {
    expect(one(p(t("Hello world.")))).toBe(out);
    const dated = one(p(t("x")));
    expect(
      build([chapter("A", p(t("x")))], { modified: new Date(Date.UTC(2026, 4, 17, 9, 5)) }),
    ).toContain("{\\creatim\\yr2026\\mo5\\dy17\\hr9\\min5}");
    expect(dated).toContain("\\yr2020");
  });
  it("starts every chapter after the first on a new page, and gives an empty page its own", () => {
    const d = build([chapter("One", p(t("a"))), chapter("Two", p(t("b"))), chapter("Three")]);
    expect(d.match(/\\pagebb/g)).toHaveLength(2);
    expect(d).toContain("\\pagebb\\outlinelevel0");
    expect(d.match(/\\pagebb/g)).toHaveLength(2);
    const blank = build([chapter("One", p(t("a"))), { ...chapter("Notes", p()), section: "back" }]);
    expect(blank.match(/\\pagebb/g)).toHaveLength(1); // no title to carry the break, so an empty paragraph does
  });
  it("uses a level-1 heading as the chapter title instead of adding one", () => {
    const d = build([
      chapter("File title", { type: "heading", attrs: { level: 1 }, content: [t("Real title")] }),
    ]);
    expect(d).toContain("Real title");
    expect(d).not.toContain("File title");
    const empty = build([
      chapter("File title", { type: "heading", attrs: { level: 1 } }, p(t("body"))),
    ]);
    expect(empty).not.toContain("File title");
  });
  it("keeps matter pages in reading order and skips the title-page page", () => {
    const d = build([
      { ...chapter("Chapter", p(t("chapter text"))), section: "chapter" },
      { ...chapter("Thanks", p(t("back text"))), section: "back" },
      { ...chapter("Title", p(t("generated"))), section: "front", kind: "title-page" },
      { ...chapter("Dedication", p(t("front text"))), section: "front" },
    ]);
    expect(d).not.toContain("generated");
    expect(d.indexOf("front text")).toBeLessThan(d.indexOf("chapter text"));
    expect(d.indexOf("chapter text")).toBeLessThan(d.indexOf("back text"));
    // Matter pages get no chapter title heading; chapters do.
    expect(d).not.toContain("Dedication");
    expect(d).toContain("Chapter");
  });
  it("names an untitled page by its id and counts only chapters towards the word count", () => {
    const d = build([
      { ...chapter("", p(t("one two three"))), id: "c1" },
      { ...chapter("Notes", p(t("back"))), section: "back" },
    ]);
    expect(d).toContain("About 3 words");
    expect(d).not.toContain("outlinelevel0 \\u");
    const only = build([{ ...chapter("Notes", p(t("alpha beta"))), section: "back" }]);
    expect(only).toContain("About 2 words");
    expect(build([chapter("A", p(t("one")))])).toContain("About 1 word\\par");
    expect(build([chapter("A", p(t(Array(150).fill("w").join(" "))))])).toContain(
      "About 200 words",
    );
  });
  it("handles an empty title and author", () => {
    const d = buildRtf({ title: " ", author: "" }, [chapter("A", p(t("x")))]);
    checkRtf(d);
    expect(d).toContain("{\\title }{\\author }");
    expect(d).toContain("fi0\\qc \\par}"); // empty title and author lines
    expect(d).toContain(
      "{\\header\\pard\\plain\\f0\\fs24\\sl240\\slmult1\\li0\\ri0\\fi0\\qr  / {\\field",
    );
  });
  it("refuses right-to-left languages and text RTF cannot hold", () => {
    expect(message(() => buildRtf({ ...book, language: "ar" }, [chapter("A")]))).toMatch(
      /Right-to-left/,
    );
    expect(message(() => buildRtf({ ...book, title: "a\u0001" }, []))).toContain("book title");
    expect(message(() => buildRtf({ ...book, author: "a\u0002" }, []))).toContain("author name");
    expect(message(() => one(p(t("bad\u0003"))))).toContain(
      "In “A”: A text run contains the character U+0003",
    );
    expect(message(() => build([chapter("T\u0001", p(t("x")))]))).toContain("The chapter title");
  });
  it("refuses a page whose document is not a doc", () => {
    const bad = [{ title: "Bad", doc: { type: "paragraph" } }] as unknown as RtfChapter[];
    expect(message(() => build(bad))).toContain('must be an object with type "doc"');
    const missing = [{ title: "Bad" }] as unknown as RtfChapter[];
    expect(message(() => build(missing))).toContain("In “Bad”");
    const anonymous = [{ title: " ", doc: { type: "paragraph" } }] as unknown as RtfChapter[];
    expect(message(() => build(anonymous))).toContain("In “(untitled page)”");
    const noContent = [{ title: "Bad", doc: { type: "doc" } }] as unknown as RtfChapter[];
    expect(message(() => build(noContent))).toContain("In “Bad”");
  });
});

describe("fonts", () => {
  it("writes the presets and any other family", () => {
    expect(build([chapter("A")], { font: "courier" })).toContain(
      "{\\f0\\fmodern\\fcharset0 Courier New;}",
    );
    expect(build([chapter("A")], { font: "times" })).toContain(
      "{\\f0\\froman\\fcharset0 Times New Roman;}",
    );
    const lora = build([chapter("A")], { font: "  Lora " });
    expect(lora).toContain("{\\f0\\fnil\\fcharset0 Lora;}");
    expect(lora).toContain("{\\f1\\fmodern\\fcharset0 Courier New;}");
  });
  it("escapes characters in a family name and refuses unusable names", () => {
    expect(build([chapter("A")], { font: "A;B {C} é" })).toContain("A\\'3bB \\{C\\} \\u233?;}");
    expect(message(() => build([chapter("A")], { font: "  " }))).toContain("font name is empty");
    expect(message(() => build([chapter("A")], { font: "x\u0001" }))).toContain("U+0001");
  });
});

describe("inline content", () => {
  it("writes marks as character formatting", () => {
    const d = one(
      p(
        t("b", m("bold")),
        t("i", m("italic")),
        t("u", m("underline")),
        t("k", m("strike")),
        t("s", m("smallCaps")),
        t("sup", m("superscript")),
        t("sub", m("subscript")),
        t("c", m("code")),
        t("all", m("bold"), m("italic")),
      ),
    );
    for (const w of [
      "{\\b b}",
      "{\\i i}",
      "{\\ul u}",
      "{\\strike k}",
      "{\\scaps s}",
      "{\\super sup}",
      "{\\sub sub}",
      "{\\f1 c}",
      "{\\b\\i all}",
    ])
      expect(d).toContain(w);
    checkRtf(d);
  });
  it("writes the language of a passage with \\lang, nothing for an unknown one, and refuses a bad tag", () => {
    const lang = (tag: string | undefined): Mark =>
      ({ type: "lang", ...(tag === undefined ? {} : { attrs: { lang: tag } }) }) as Mark;
    const d = one(p(t("salut", lang("fr-CA")), t("qapla", lang("x-klingon"))));
    checkRtf(d);
    expect(d).toContain("{\\lang3084 salut}");
    expect(d).toContain("qapla");
    expect(d.match(/\{\\lang\d+ /g)).toHaveLength(1);
    expect(message(() => one(p(t("x", lang(undefined)))))).toContain("BCP 47");
    expect(message(() => one(p(t("x", lang("a b")))))).toContain("BCP 47");
  });
  it("writes links as fields with the address escaped", () => {
    const d = one(p(t("site", m("link", 'https://example.com/?a="1"&b=é\\'))));
    checkRtf(d);
    expect(d).toContain(
      '{\\field{\\*\\fldinst{HYPERLINK "https://example.com/?a=%221%22&b=\\u233?\\\\"}}{\\fldrslt {\\ul\\cf1 site}}}',
    );
  });
  it("refuses a link without an address or with an unwritable one", () => {
    expect(message(() => one(p(t("x", { type: "link" } as Mark))))).toContain("without an address");
    expect(message(() => one(p(t("x", m("link", "")))))).toContain("without an address");
    expect(message(() => one(p(t("x", m("link", "a\u0001")))))).toContain("A link address");
  });
  it("writes footnotes as real RTF footnotes and hard breaks as line breaks", () => {
    const d = one(
      p(
        t("claim"),
        { type: "footnote", content: [t("the note")] },
        { type: "hardBreak" },
        t("after"),
      ),
    );
    checkRtf(d);
    expect(d).toContain("{\\super\\chftn {\\footnote\\pard\\plain\\f0\\fs20");
    expect(d).toContain("{\\super\\chftn} the note\\par}}");
    expect(d).toContain("\\line ");
  });
  it("skips empty text and refuses unknown nodes, marks and nested footnotes", () => {
    expect(one(p(t("")))).not.toMatch(/\\fi720\\ql /);
    expect(message(() => one(p({ type: "mystery" } as unknown as DocNode)))).toContain('"mystery"');
    expect(message(() => one(p(t("x", { type: "wiggle" } as unknown as Mark))))).toContain(
      '"wiggle"',
    );
    expect(message(() => one(p(t("x", m("superscript"), m("subscript")))))).toContain(
      "both superscript and subscript",
    );
    expect(
      message(() =>
        one(p({ type: "footnote", content: [{ type: "footnote", content: [t("n")] }] })),
      ),
    ).toContain("another footnote");
  });
  it("writes tabs and line feeds inside text", () => {
    expect(one(p(t("a\tb\nc")))).toContain("a\\tab b\\line c");
  });
  it("inline() accepts no nodes", () => {
    const ctx: Ctx = {
      s: { assets: new Map(), pendingBreak: false },
      chapter: "C",
      quote: 0,
      list: 0,
      inNote: false,
      runProps: {},
    };
    expect(inline(undefined, ctx)).toBe("");
    expect(runWords([], { bold: true }, ctx)).toBe("\\b");
  });
});

describe("blocks", () => {
  it("drops empty paragraphs, headings and captions", () => {
    const d = one(
      p(),
      { type: "heading", attrs: { level: 2 } },
      { type: "figcaption" },
      p(t("kept")),
    );
    expect(d).not.toContain("outlinelevel1");
    expect(d).toContain("kept");
  });
  it("writes headings with outline levels, level 1 centred, and defaults the level to 1", () => {
    const d = one(
      { type: "heading", attrs: { level: 1 }, content: [t("H1")] },
      { type: "heading", attrs: { level: 2 }, content: [t("H2")] },
      { type: "heading", attrs: { level: 3 }, content: [t("H3")] },
      { type: "heading", content: [t("H0")] },
    );
    expect(d).toMatch(/\\fi0\\qc\\keepn\\outlinelevel0 H1\\par/);
    expect(d).toMatch(/\\fi0\\ql\\keepn\\outlinelevel1 H2\\par/);
    expect(d).toMatch(/\\fi0\\ql\\keepn\\outlinelevel2 H3\\par/);
    expect(d).toMatch(/\\qc\\keepn\\outlinelevel0 H0\\par/);
  });
  it("refuses other heading levels and unknown blocks", () => {
    expect(
      message(() => one({ type: "heading", attrs: { level: 5 }, content: [t("x")] })),
    ).toContain("Heading level 5");
    expect(message(() => one({ type: "wiggle" } as unknown as DocNode))).toContain('"wiggle"');
  });
  it("indents block quotes by depth and keeps lists and code inside them", () => {
    const d = one({
      type: "blockquote",
      content: [
        p(t("outer")),
        {
          type: "blockquote",
          content: [
            p(t("inner")),
            { type: "codeBlock", content: [t("code")] },
            { type: "bulletList", content: [item(p(t("li")))] },
          ],
        },
      ],
    });
    expect(d).toContain("\\li720\\ri720\\fi0\\ql outer");
    expect(d).toContain("\\li1440\\ri720\\fi0\\ql inner");
    expect(d).toMatch(/\\f1\\fs22\\sl240\\slmult1\\sb0\\sa0\\li1440\\ri0\\fi0\\ql code/);
    expect(d).toContain("\\li2160\\ri0\\fi-360");
  });
  it("writes code blocks line by line in Courier New, escaped", () => {
    const d = one({ type: "codeBlock", content: [t("a { b }\n\nlet é = 1;")] });
    checkRtf(d);
    expect(d.match(/\\f1\\fs22/g)).toHaveLength(3);
    expect(d).toContain("a \\{ b \\}\\par");
    expect(d).toContain("let \\u233? = 1;");
    expect(one({ type: "codeBlock" })).toMatch(/\\f1\\fs22[^\n]* \\par\}/);
    expect(message(() => one({ type: "codeBlock", content: [{ type: "hardBreak" }] }))).toContain(
      "code block",
    );
    expect(message(() => one({ type: "codeBlock", content: [t("a\u0001")] }))).toContain(
      "A code block",
    );
  });
  it("writes scene breaks as a centred #", () => {
    expect(one({ type: "sceneBreak" })).toContain("\\fi0\\qc #\\par");
  });

  it("writes page breaks as a \\page", () => {
    const doc = one(p(t("Before.")), { type: "pageBreak" }, p(t("After.")));
    expect(doc).toContain("\\page");
    expect(doc).toContain("After.");
  });
  it("writes figcaptions", () => {
    const d = one({ type: "figcaption", content: [t("Cap")] });
    expect(d).toContain("\\sl240\\slmult1\\sb120\\sa240\\li0\\ri0\\fi0\\qc\\i Cap\\par");
  });
});
