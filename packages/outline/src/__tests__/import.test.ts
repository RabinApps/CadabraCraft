import { describe, expect, it } from "vitest";
import { chapterDocProblem } from "@cadabracraft/editor-schema";
import {
  MAX_OUTLINE_BYTES,
  MAX_OUTLINE_CHAPTERS,
  MAX_OUTLINE_SCENES,
  OutlineError,
  buildOutline,
  fromCsv,
  outlineFormatOfFile,
  outlineToPages,
  parseOutline,
  toCsv,
  toMarkdown,
  toOpml,
} from "../index";

const code = (f: () => unknown): string | undefined => {
  try {
    f();
  } catch (e) {
    return e instanceof OutlineError ? e.code : "other";
  }
  return undefined;
};

describe("fromCsv", () => {
  it("reads a hand-made file: any column order, other header names, semicolons, groups by chapter", () => {
    const r = fromCsv(
      [
        "Scene;Summary;Chapter;Point of view;Story date;Target;Status",
        "Storm;Ana runs;Act one;Ana;2024-05-01;1500;Draft",
        "Harbour;;Act one;;;;",
        "Dawn;Quiet;Act two;Ben;;;final",
      ].join("\n"),
    );
    expect(r.warnings).toEqual([]);
    expect(r.chapters.map((c) => [c.title, c.scenes.map((s) => s.title)])).toEqual([
      ["Act one", ["Storm", "Harbour"]],
      ["Act two", ["Dawn"]],
    ]);
    expect(r.chapters[0]!.scenes[0]).toMatchObject({
      synopsis: "Ana runs",
      pov: "Ana",
      date: "2024-05-01",
      target: 1500,
      status: "draft",
    });
  });
  it("reads tab separated files, quoted cells with separators, quotes and line breaks, and a BOM", () => {
    const r = fromCsv('﻿chapter\ttitle\tsynopsis\r\nOne\t"a ""b""\tc"\t"x\r\ny"\r\n');
    expect(r.chapters[0]!.scenes[0]).toMatchObject({ title: 'a "b"\tc', synopsis: "x\r\ny" });
  });
  it("takes the cast names from the cast column and drops blank rows", () => {
    const r = fromCsv('chapter,title,cast\nA,S,"Ana; Ben, Cy"\n,,\n\nA,T,\n');
    expect(r.chapters).toHaveLength(1);
    expect(r.chapters[0]!.scenes[0]!.castNames).toEqual(["Ana", "Ben", "Cy"]);
    expect(r.chapters[0]!.scenes).toHaveLength(2);
  });
  it("keeps a chapter that has no scenes and uses one untitled chapter without a chapter column", () => {
    expect(fromCsv("chapter,title\nEmpty,\nFull,S").chapters.map((c) => c.scenes.length)).toEqual([
      0, 1,
    ]);
    const r = fromCsv("title,pov\nA,x\nB,y");
    expect(r.chapters).toEqual([
      expect.objectContaining({ title: "", scenes: [expect.anything(), expect.anything()] }),
    ]);
  });
  it("starts a new chapter when the number changes even if the name repeats", () => {
    const r = fromCsv("chapter_number,chapter,title\n1,Same,A\n2,Same,B");
    expect(r.chapters).toHaveLength(2);
  });
  it("gives back the apostrophe the writer added against formulas", () => {
    const r = fromCsv("chapter,title,synopsis\n'=A,'+B,'@C and 'plain");
    expect(r.chapters[0]!.title).toBe("=A");
    expect(r.chapters[0]!.scenes[0]).toMatchObject({ title: "+B", synopsis: "@C and 'plain" });
  });
  it("warns about short rows and cleans bad values", () => {
    const r = fromCsv("chapter,title,status,target,date\nA,S,odd,-3,soon\nA,T");
    expect(r.warnings.map((w) => w.code).sort()).toEqual([
      "bad-date",
      "bad-status",
      "bad-target",
      "ignored",
    ]);
  });
  it("round trips what toCsv writes", () => {
    const outline = buildOutline({ title: "t", author: "" }, [
      {
        id: "c1",
        title: "One, the first",
        doc: {
          type: "doc",
          content: [
            {
              type: "scene",
              attrs: {
                id: "sc-1",
                title: "=Hot",
                synopsis: 'He said "go".\nShe went.',
                pov: "Ana",
                status: "draft",
                target: 900,
                date: "2024-05-01",
              },
              content: [{ type: "paragraph", content: [{ type: "text", text: "w" }] }],
            },
          ],
        },
      },
      { id: "c2", title: "Two", doc: { type: "doc", content: [] } },
    ]);
    const r = fromCsv(toCsv(outline));
    expect(r.warnings).toEqual([]);
    expect(r.chapters.map((c) => c.title)).toEqual(["One, the first", "Two"]);
    expect(r.chapters[0]!.scenes[0]).toMatchObject({
      title: "=Hot",
      synopsis: 'He said "go".\nShe went.',
      pov: "Ana",
      status: "draft",
      target: 900,
      date: "2024-05-01",
    });
    expect(r.chapters[1]!.scenes).toEqual([]);
  });
  it("refuses an unclosed quote, a file with no known column and oversized or huge files", () => {
    expect(code(() => fromCsv('chapter,title\nA,"open'))).toBe("malformed");
    expect(code(() => fromCsv("foo,bar\n1,2"))).toBe("not-csv");
    expect(code(() => fromCsv("x".repeat(MAX_OUTLINE_BYTES + 1)))).toBe("too-large");
    const chapters = [
      "chapter,title",
      ...Array.from({ length: MAX_OUTLINE_CHAPTERS + 1 }, (_, i) => `c${i},s`),
    ];
    expect(code(() => fromCsv(chapters.join("\n")))).toBe("too-many");
    const scenes = [
      "chapter,title",
      ...Array.from({ length: MAX_OUTLINE_SCENES + 1 }, () => "c,s"),
    ];
    expect(code(() => fromCsv(scenes.join("\n")))).toBe("too-many");
  });
  it("reads an empty file as no chapters", () => {
    expect(fromCsv("").chapters).toEqual([]);
    expect(fromCsv("﻿\r\n").chapters).toEqual([]);
  });
});

describe("parseOutline and outlineFormatOfFile", () => {
  it("names the format from the file name", () => {
    expect(outlineFormatOfFile("a.OPML")).toBe("opml");
    expect(outlineFormatOfFile("dir/a.csv")).toBe("csv");
    expect(outlineFormatOfFile("a.md")).toBe("markdown");
    expect(outlineFormatOfFile("a.markdown")).toBe("markdown");
    expect(outlineFormatOfFile("a.docx")).toBeNull();
    expect(outlineFormatOfFile("noext")).toBeNull();
  });
  it("picks the parser and refuses a file with nothing in it", () => {
    expect(parseOutline("# A\n## S\n", "markdown").chapters[0]!.scenes).toHaveLength(1);
    expect(parseOutline("chapter,title\nA,S", "csv").chapters).toHaveLength(1);
    expect(
      parseOutline('<opml version="2.0"><body><outline text="A"/></body></opml>', "opml").chapters,
    ).toHaveLength(1);
    expect(code(() => parseOutline("just words", "markdown"))).toBe("empty");
    expect(code(() => parseOutline("", "csv"))).toBe("empty");
    expect(code(() => parseOutline("<opml><body/></opml>", "opml"))).toBe("empty");
    expect(code(() => parseOutline("<html/>", "opml"))).toBe("not-opml");
  });
});

describe("outlineToPages", () => {
  const ids = () => {
    let n = 0;
    return () => `new-${++n}`;
  };
  it("makes valid chapter documents with fresh scene ids, and leaves out the file's own ids", () => {
    const parsed = parseOutline(
      '<opml version="2.0" xmlns:cc="urn:x"><body><outline text="One">' +
        '<outline text="S" _note="n" cc:id="sc-1" cc:pov="Ana" cc:status="draft" cc:target="9" cc:date="2024-05-01" cc:cast="a b"/>' +
        '<outline text="T" cc:id="bad id"/><outline text="U" cc:id="sc-1"/></outline><outline text=""/></body></opml>',
      "opml",
    );
    const { pages, warnings } = outlineToPages(parsed, ids(), "Nameless");
    expect(pages.map((p) => [p.title, p.sceneCount])).toEqual([
      ["One", 3],
      ["Nameless", 0],
    ]);
    for (const p of pages) expect(chapterDocProblem(p.doc)).toBeNull();
    const first = pages[0]!.doc.content[1]!;
    expect(first).toMatchObject({
      type: "scene",
      attrs: {
        id: "new-1",
        title: "S",
        synopsis: "n",
        pov: "Ana",
        status: "draft",
        target: 9,
        date: "2024-05-01",
      },
    });
    expect(warnings.map((w) => w.code)).toEqual(["cast-skipped"]);
    expect(pages[1]!.doc.content).toHaveLength(2);
  });
  it("round trips an exported outline through each format with the same notes", () => {
    const outline = buildOutline({ title: "t", author: "" }, [
      {
        id: "c1",
        title: "One",
        doc: {
          type: "doc",
          content: [
            {
              type: "scene",
              attrs: {
                id: "sc-1",
                title: "Storm",
                synopsis: "Ana runs.",
                pov: "Ana",
                status: "outline",
                label: "act1",
                target: 500,
                date: "2024-05-01T08:30",
              },
              content: [{ type: "paragraph" }],
            },
          ],
        },
      },
    ]);
    for (const [text, format] of [
      [toOpml(outline), "opml"],
      [toMarkdown(outline), "markdown"],
      [toCsv(outline), "csv"],
    ] as const) {
      const { pages } = outlineToPages(parseOutline(text, format), ids());
      expect(chapterDocProblem(pages[0]!.doc)).toBeNull();
      expect(pages[0]!.doc.content[1]!).toMatchObject({
        attrs: {
          title: "Storm",
          synopsis: "Ana runs.",
          pov: "Ana",
          status: "outline",
          label: "act1",
          target: 500,
          date: "2024-05-01T08:30",
        },
      });
    }
  });
});
