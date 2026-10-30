import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { ChapterDoc, DocNode, Mark } from "@cadabracraft/shared";
import {
  RtfExportError,
  approximateWords,
  authorSurname,
  buildRtf,
  type RtfChapter,
  type RtfOptions,
} from "../index";
import { picture } from "../image";
import { orderedLabel } from "../lists";
import { inline, para, paraOpen, runWords, textRuns } from "../paragraphs";
import { settleTables } from "../tables";
import { esc, illegalChar } from "../text";
import type { Ctx } from "../types";

const t = (text: string, ...marks: Mark[]): DocNode => ({
  type: "text",
  text,
  ...(marks.length ? { marks } : {}),
});
const p = (...content: DocNode[]): DocNode => ({ type: "paragraph", content });
const doc = (...content: DocNode[]): ChapterDoc => ({ type: "doc", content });
const chapter = (title: string, ...content: DocNode[]): RtfChapter => ({
  title,
  doc: doc(...content),
});
const item = (...content: DocNode[]): DocNode => ({ type: "listItem", content });
const row = (...cells: DocNode[]): DocNode => ({ type: "tableRow", content: cells });
const cell = (...content: DocNode[]): DocNode => ({ type: "tableCell", content });
const head = (...content: DocNode[]): DocNode => ({ type: "tableHeader", content });
const table = (...rows: DocNode[]): DocNode => ({ type: "table", content: rows });
const image = (attrs?: Record<string, string | null>): DocNode =>
  (attrs ? { type: "image", attrs } : { type: "image" }) as DocNode;
const m = (type: string, href?: string): Mark =>
  ({ type, ...(href !== undefined ? { attrs: { href } } : {}) }) as Mark;

const book = { title: "The Long Road", author: "Ada Lovelace" };
const build = (chapters: RtfChapter[], options?: RtfOptions): string =>
  buildRtf(book, chapters, options);
const one = (...content: DocNode[]): string => build([chapter("A", ...content)]);
const message = (fn: () => unknown): string => {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(RtfExportError);
    return (e as Error).message;
  }
  throw new Error("did not throw");
};

const png = new Uint8Array(
  readFileSync(new URL("../../../../fixtures/assets/pixel.png", import.meta.url)),
);
const bytes = (length: number, ...at: [number, number[]][]): Uint8Array => {
  const b = new Uint8Array(length);
  for (const [i, v] of at) b.set(v, i);
  return b;
};
const ascii = (s: string): number[] => [...s].map((c) => c.charCodeAt(0));
const PNG_HEAD: [number, number[]][] = [
  [0, [0x89, ...ascii("PNG")]],
  [12, ascii("IHDR")],
];
const pngOf = (w: number, h: number): Uint8Array =>
  bytes(32, ...PNG_HEAD, [16, [0, 0, w >> 8, w & 255]], [20, [0, 0, h >> 8, h & 255]]);
const jpegOf = (w: number, h: number): Uint8Array =>
  bytes(
    32,
    [0, [0xff, 0xd8, 0xff, 0xe0, 0, 4, 0, 0, 0xff, 0xc0, 0, 11, 8]],
    [13, [h >> 8, h & 255, w >> 8, w & 255]],
  );

/** A reader-independent well-formedness check: balanced groups, only 7-bit ASCII, every `\` starts a control word or symbol. */
function checkRtf(rtf: string): void {
  expect(rtf.startsWith("{\\rtf1")).toBe(true);
  expect([...rtf].every((c) => c === "\n" || (c >= " " && c <= "~"))).toBe(true);
  let depth = 0;
  for (let i = 0; i < rtf.length; i++) {
    const c = rtf[i];
    if (c === "\\") {
      const next = rtf[i + 1]!;
      expect(/[A-Za-z\\{}*'~\-_|]/.test(next), `control at ${i}: ${rtf.slice(i, i + 12)}`).toBe(
        true,
      );
      i += next === "'" ? 3 : 1;
    } else if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      expect(depth).toBeGreaterThanOrEqual(0);
    }
  }
  expect(depth).toBe(0);
}

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
  it("writes figcaptions", () => {
    const d = one({ type: "figcaption", content: [t("Cap")] });
    expect(d).toContain("\\sl240\\slmult1\\sb120\\sa240\\li0\\ri0\\fi0\\qc\\i Cap\\par");
  });
});

describe("task and definition lists", () => {
  it("writes a ballot box for each task item and indents nested tasks", () => {
    const d = one({
      type: "taskList",
      content: [
        {
          type: "taskItem",
          attrs: { checked: true },
          content: [
            p(t("done")),
            { type: "taskList", content: [{ type: "taskItem", content: [p(t("nested"))] }] },
          ],
        },
        { type: "taskItem", attrs: { checked: false }, content: [p(t("todo"))] },
      ],
    });
    checkRtf(d);
    expect(d).toContain("\\fi-360\\ql \\u9746?\\tab done");
    expect(d).toContain("\\li1440\\ri0\\fi-360\\ql \\u9744?\\tab nested");
    expect(d).toContain("\\u9744?\\tab todo");
  });
  it("writes terms in bold and descriptions indented", () => {
    const d = one({
      type: "definitionList",
      content: [
        { type: "definitionTerm", content: [t("Term")] },
        { type: "definitionDescription", content: [p(t("Meaning")), p(t("More"))] },
      ],
    });
    checkRtf(d);
    expect(d).toMatch(/\\keepn[^}]*\\b Term/);
    expect(d).toContain("\\li720\\ri0\\fi0");
    expect(d).toContain("Meaning");
    expect(d).toContain("More");
  });
  it("refuses a bad checked value, a task item without a leading paragraph and too deep nesting", () => {
    expect(() =>
      one({
        type: "taskList",
        content: [{ type: "taskItem", attrs: { checked: "yes" }, content: [p(t("x"))] }],
      }),
    ).toThrow(/checked value/);
    expect(() =>
      one({ type: "taskList", content: [{ type: "taskItem", content: [{ type: "sceneBreak" }] }] }),
    ).toThrow(/must start with a paragraph/);
    expect(() =>
      one({
        type: "definitionList",
        content: [
          { type: "definitionTerm", content: [t("a")] },
          { type: "definitionDescription", content: [{ type: "sceneBreak" }] },
        ],
      }),
    ).toThrow(/must start with a paragraph/);
    let deep: DocNode = { type: "taskItem", content: [p(t("x"))] };
    for (let i = 0; i < 10; i++)
      deep = {
        type: "taskItem",
        content: [p(t("x")), { type: "taskList", content: [deep] }],
      };
    expect(message(() => one({ type: "taskList", content: [deep] }))).toContain("9 levels");
  });
  it("writes extra paragraphs and other blocks inside items and descriptions", () => {
    const d = one(
      {
        type: "taskList",
        content: [
          {
            type: "taskItem",
            content: [p(t("a")), p(t("second")), p(), { type: "sceneBreak" }],
          },
        ],
      },
      {
        type: "definitionList",
        content: [
          { type: "definitionTerm", content: [t("T")] },
          {
            type: "definitionDescription",
            content: [p(t("d1")), p(t("d2")), p(), { type: "sceneBreak" }],
          },
        ],
      },
    );
    checkRtf(d);
    expect(d).toContain("second");
    expect(d).toContain("d2");
  });
  it("refuses a stray node in either list", () => {
    expect(() => one({ type: "taskList", content: [p(t("x"))] })).toThrow(
      /cannot be written in a task list/,
    );
    expect(() => one({ type: "definitionList", content: [p(t("x"))] })).toThrow(
      /cannot be written in a definition list/,
    );
  });
});

describe("lists", () => {
  it("writes bullets with a hanging indent and alternating markers by level", () => {
    const d = one({
      type: "bulletList",
      content: [item(p(t("top")), { type: "bulletList", content: [item(p(t("nested")))] })],
    });
    checkRtf(d);
    expect(d).toContain("\\li720\\ri0\\fi-360\\ql \\u8226?\\tab top");
    expect(d).toContain("\\li1440\\ri0\\fi-360\\ql \\u8211?\\tab nested");
  });
  it("numbers ordered lists from the start value, restarting for each list", () => {
    const d = one(
      { type: "orderedList", attrs: { start: 3 }, content: [item(p(t("a"))), item(p(t("b")))] },
      { type: "orderedList", content: [item(p(t("c")))] },
      { type: "orderedList", attrs: { start: 1.5 }, content: [item(p(t("d")))] },
      { type: "orderedList", attrs: { start: -2 }, content: [item(p(t("e")))] },
      { type: "orderedList", attrs: { start: 0 }, content: [item(p(t("f")))] },
    );
    for (const w of ["3.\\tab a", "4.\\tab b", "1.\\tab c", "1.\\tab d", "1.\\tab e", "0.\\tab f"])
      expect(d).toContain(w);
  });
  it("labels nested ordered lists with decimal, letters and Roman numerals", () => {
    expect(orderedLabel(2, 0)).toBe("2.");
    expect(orderedLabel(2, 1)).toBe("b.");
    expect(orderedLabel(27, 1)).toBe("aa.");
    expect(orderedLabel(702, 1)).toBe("zz.");
    expect(orderedLabel(703, 1)).toBe("aaa.");
    expect(orderedLabel(4, 2)).toBe("iv.");
    expect(orderedLabel(1994, 2)).toBe("mcmxciv.");
    expect(orderedLabel(0, 1)).toBe("0.");
    expect(orderedLabel(0, 2)).toBe("0.");
    expect(orderedLabel(4000, 2)).toBe("4000.");
    expect(orderedLabel(3, 3)).toBe("3.");
  });
  it("keeps the other paragraphs of an item at the item's indent and handles odd items", () => {
    const d = one({
      type: "bulletList",
      content: [
        item(p(t("first")), p(t("second")), p(), { type: "codeBlock", content: [t("code")] }),
        item({ type: "codeBlock", content: [t("only code")] }),
        item(),
        item(p()),
      ],
    });
    checkRtf(d);
    expect(d).toContain("\\li720\\ri0\\fi0\\ql second");
    expect(d).toContain("\\f1\\fs22\\sl240\\slmult1\\sb0\\sa0\\li0\\ri0\\fi0\\ql code");
    expect(d.match(/\\u8226\?\\tab /g)).toHaveLength(4);
  });
  it("refuses non-items and lists nested too deep", () => {
    expect(message(() => one({ type: "bulletList", content: [p(t("x"))] }))).toContain(
      '"paragraph"',
    );
    let deep: DocNode = { type: "bulletList", content: [item(p(t("x")))] };
    for (let i = 0; i < 9; i++) deep = { type: "bulletList", content: [item(deep)] };
    expect(message(() => one(deep))).toContain("9 levels");
  });
});

describe("tables", () => {
  const sample = table(
    row(head(p(t("H1"))), head(p(t("H2")))),
    row(cell(p(t("a"))), cell(p(t("b"), t("c")))),
  );
  it("writes header rows that repeat, bordered cells of equal width and a bold header", () => {
    const d = one(sample, p(t("after")));
    checkRtf(d);
    expect(d).toContain("\\trowd\\trgaph108\\trleft0\\trkeep\\trhdr");
    expect(d).toContain("\\cellx4680\\clbrdrt");
    expect(d).toContain("\\cellx9360");
    expect(d).toContain("\\intbl\\f0\\fs24\\sl240");
    expect(d).toMatch(/\\b H1\}\\cell/);
    expect(d.match(/\\row/g)).toHaveLength(2);
    expect(d.match(/\\trhdr/g)).toHaveLength(1);
  });
  it("separates a table from the next table and from the end of the document", () => {
    const end = one(sample);
    expect(end.trimEnd().endsWith("\\par}\n}".trimEnd())).toBe(true);
    const two = one(sample, sample);
    expect(two.split("\\row\n").length).toBe(5);
    expect(two).toMatch(
      /\\row\n\n?\{\\pard\\plain\\f0\\fs24\\sl240\\slmult1\\li0\\fi0\\par\}\n\\trowd/,
    );
    expect(one(sample, p(t("x")))).not.toMatch(
      /\\row\n\n?\{\\pard\\plain\\f0\\fs24\\sl240\\slmult1\\li0\\fi0\\par\}/,
    );
  });
  it("joins the paragraphs of a cell and writes empty cells", () => {
    const d = one(table(row(cell(p(t("one")), p(t("two"))), cell())));
    checkRtf(d);
    expect(d).toMatch(/ one\\par\\pard\\plain\\lang1033\\intbl[^ ]* two\\cell/);
    expect(d).toMatch(/\\intbl[^ ]* \\cell/);
  });
  it("puts a page break before a table that starts a chapter", () => {
    const d = build([
      chapter("One", p(t("a"))),
      { title: "Two", doc: doc(sample), section: "back" },
    ]);
    expect(d.match(/\\pagebb/g)).toHaveLength(1);
    expect(d).toMatch(/\\pagebb[^\n]* \\par\}\n\\trowd/);
  });
  it("refuses malformed tables", () => {
    expect(message(() => one(table()))).toContain("no rows");
    expect(message(() => one(table(row())))).toContain("no cells");
    expect(message(() => one(table(row(cell(p(t("a")))), row(cell(), cell()))))).toContain(
      "same number of cells",
    );
    expect(message(() => one(table(p(t("x")))))).toContain(
      '"paragraph" cannot be written in a table',
    );
    expect(message(() => one(table(row(p(t("x"))))))).toContain(
      '"paragraph" cannot be written in a table row',
    );
    expect(message(() => one(table(row(cell({ type: "codeBlock" } as DocNode)))))).toContain(
      '"codeBlock"',
    );
  });
  it("settleTables leaves other parts alone", () => {
    expect(settleTables(["a", "\u0001", "b", "\u0001", "\\trowd", "\u0001"])).toEqual([
      "a",
      "b",
      expect.stringContaining("\\par"),
      "\\trowd",
      expect.stringContaining("\\par"),
    ]);
  });
});

describe("language", () => {
  const withLang = (language?: string): string =>
    buildRtf({ ...book, ...(language ? { language } : {}) }, [chapter("A", p(t("x")))]);
  it("writes the default and paragraph language as a Windows language id", () => {
    const d = withLang("de-AT");
    checkRtf(d);
    expect(d).toContain("\\uc1\\deflang3079\\deflangfe3079\n");
    expect(d).toContain("\\pard\\plain\\lang3079\\f0");
    expect(d).not.toContain("\\lang1033");
  });
  it("uses US English without a language and the language's usual region without one", () => {
    expect(withLang()).toContain("\\deflang1033");
    expect(withLang("fr")).toContain("\\deflang1036");
    expect(withLang("pt_BR")).toContain("\\deflang1046");
    expect(withLang("zh-Hant")).toContain("\\deflang1028");
    expect(withLang("zh-Hant-TW")).toContain("\\deflang1028");
    expect(withLang("en-ZZ")).toContain("\\deflang1033"); // an unknown region falls back to the language
  });
  it("writes no language for one it has no id for", () => {
    const d = withLang("sw");
    expect(d).not.toContain("\\deflang");
    expect(d).not.toContain("\\lang");
    checkRtf(d);
  });
});

describe("images", () => {
  const assets = new Map([["assets/a.png", png]]);
  const imageDoc = (src: string, extra: Record<string, string | null> = {}): DocNode =>
    image({ src, alt: "alt", ...extra });
  it("embeds a PNG as hex with its size, and a caption from the title", () => {
    const d2 = build([chapter("A", imageDoc("assets/a.png", { title: "Fig <1>" }))], { assets });
    checkRtf(d2);
    expect(d2).toContain("\\pngblip\\picw");
    expect(d2).toContain("\\picwgoal15\\pichgoal15\n");
    expect(d2).toContain(Buffer.from(png).toString("hex").slice(0, 64));
    expect(d2).toContain("\\keepn");
    expect(d2).toContain("\\i Fig <1>\\par");
  });
  it("writes the alt text as the picture's wzDescription property, escaped, and nothing for a decorative image", () => {
    const d = build([chapter("A", imageDoc("assets/a.png", { alt: "A {quay} \\ café" }))], {
      assets,
    });
    checkRtf(d);
    expect(d).toContain(
      "{\\pict{\\*\\picprop\\shplid1025{\\sp{\\sn shapeType}{\\sv 75}}{\\sp{\\sn wzDescription}{\\sv A \\{quay\\} \\\\ caf\\u233?}}}\\pngblip",
    );
    const decorative = build([chapter("A", imageDoc("assets/a.png", { alt: "" }))], { assets });
    expect(decorative).toContain("{\\pict\\pngblip");
    expect(decorative).not.toContain("picprop");
    const bad = chapter("A", imageDoc("assets/a.png", { alt: "x\u0001" }));
    expect(message(() => build([bad], { assets }))).toContain("An image description");
  });
  it("scales wide and tall images to the text area and writes JPEGs", () => {
    const wide = new Map([["assets/w.png", pngOf(2000, 100)]]);
    const w = build([chapter("A", imageDoc("assets/w.png"))], { assets: wide });
    expect(w).toContain("\\picwgoal9360\\pichgoal468");
    const tall = new Map([["assets/t.jpg", jpegOf(100, 2000)]]);
    const tl = build([chapter("A", imageDoc("assets/t.jpg"))], { assets: tall });
    expect(tl).toContain("\\jpegblip");
    expect(tl).toContain("\\pichgoal12960");
    checkRtf(tl);
  });
  it("wraps picture data in 64-byte lines", () => {
    const d = build([chapter("A", imageDoc("assets/a.png"))], { assets });
    const data = d.slice(d.indexOf("\\pichgoal")).split("\n").slice(1);
    expect(data.length).toBeGreaterThan(1);
    expect(data[0]!.length).toBe(128);
  });
  it("refuses images RTF cannot hold and says why", () => {
    const ctx = (a: Map<string, Uint8Array>): Ctx => ({
      s: { assets: a, pendingBreak: false },
      chapter: "C",
      quote: 0,
      list: 0,
      inNote: false,
      runProps: {},
    });
    const fail = (src: string, a = new Map<string, Uint8Array>()) =>
      message(() => picture(src, ctx(a)));
    expect(fail("http://x/a.png")).toContain("not a project image");
    expect(fail("assets/a.txt")).toContain("unsupported type");
    expect(fail("assets/a.svg")).toContain("an SVG");
    expect(fail("assets/a.gif")).toContain("a GIF");
    expect(fail("assets/a.webp")).toContain("a WEBP");
    expect(fail("assets/a.png")).toContain("missing");
    expect(fail("assets/a.png", new Map([["assets/a.png", new Uint8Array(40)]]))).toContain(
      "not a readable PNG",
    );
    expect(fail("assets/a.jpg", new Map([["assets/a.jpg", new Uint8Array(40)]]))).toContain(
      "not a readable JPEG",
    );
    expect(fail("assets/a.png", new Map([["assets/a.png", pngOf(0, 10)]]))).toContain(
      "not a readable PNG",
    );
    expect(message(() => one(image()))).toContain("not a project image");
    expect(message(() => one(imageDoc("assets/a.png", { title: "x\u0001" })))).toContain("missing");
    expect(
      message(() =>
        build([chapter("A", imageDoc("assets/a.png", { title: "x\u0001" }))], { assets }),
      ),
    ).toContain("An image caption");
  });
  it("reads JPEG headers past other segments and refuses ones without a frame header", () => {
    const seg = (marker: number, len: number, ...rest: number[]): number[] => [
      0xff,
      marker,
      len >> 8,
      len & 255,
      ...rest,
    ];
    const ok = new Uint8Array([
      0xff,
      0xd8,
      0x00,
      0x00, // junk before a marker
      0xff,
      0xff, // fill byte
      ...seg(0xe0, 4, 0, 0),
      0xff,
      0x01, // standalone marker
      ...seg(0xc4, 4, 0, 0), // DHT is not a frame header
      ...seg(0xc2, 11, 8, 0, 20, 0, 30, 0, 0, 0),
      0,
      0,
      0,
    ]);
    const a = new Map([["assets/o.jpg", ok]]);
    expect(build([chapter("A", imageDoc("assets/o.jpg"))], { assets: a })).toContain(
      "\\picwgoal450\\pichgoal300",
    );
    const none = new Map([
      ["assets/n.jpg", new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 4, 0, 0, 0, 0, 0, 0, 0])],
    ]);
    expect(
      message(() => build([chapter("A", imageDoc("assets/n.jpg"))], { assets: none })),
    ).toContain("not a readable JPEG");
    const short = new Map([["assets/s.jpg", new Uint8Array([0xff, 0xd8])]]);
    expect(
      message(() => build([chapter("A", imageDoc("assets/s.jpg"))], { assets: short })),
    ).toContain("not a readable JPEG");
  });
});

describe("paragraph helpers", () => {
  it("paraOpen consumes the pending break once", () => {
    const ctx: Ctx = {
      s: { assets: new Map(), pendingBreak: true },
      chapter: "C",
      quote: 0,
      list: 0,
      inNote: false,
      runProps: {},
    };
    expect(paraOpen({}, ctx)).toContain("\\pagebb");
    expect(paraOpen({ bold: true, italic: true, cell: true, mono: true, size: 20 }, ctx)).toBe(
      "\\pard\\plain\\intbl\\f1\\fs20\\sl480\\slmult1\\sb0\\sa0\\li0\\ri0\\fi720\\ql\\b\\i",
    );
    expect(para("x", {}, ctx)).toMatch(/^\{\\pard.* x\\par\}$/);
  });
  it("author surnames and word counts", () => {
    expect(authorSurname("Ada Lovelace")).toBe("Lovelace");
    expect(authorSurname("Martin Luther King Jr.")).toBe("King");
    expect(authorSurname("Lovelace, Ada")).toBe("Ada");
    expect(authorSurname("Madonna")).toBe("Madonna");
    expect(authorSurname("")).toBe("");
    expect(authorSurname("Jr")).toBe("Jr");
    expect(approximateWords(99)).toBe(99);
    expect(approximateWords(149)).toBe(100);
    expect(approximateWords(150)).toBe(200);
  });
  it("RtfExportError carries the page and node", () => {
    const e = new RtfExportError("boom", { chapter: "Ch", node: "image" });
    expect(e.chapter).toBe("Ch");
    expect(e.node).toBe("image");
    expect(e.message).toBe("In “Ch”: boom");
    expect(new RtfExportError("plain").message).toBe("plain");
  });
});
