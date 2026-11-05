import { describe, expect, it } from "vitest";
import {
  CSV_COLUMNS,
  MAX_OUTLINE_BYTES,
  MAX_OUTLINE_CHAPTERS,
  MAX_OUTLINE_SCENES,
  OPML_NAMESPACE,
  OUTLINE_FORMATS,
  OutlineError,
  buildOutline,
  fromMarkdown,
  fromOpml,
  serializeOutline,
  toCsv,
  toMarkdown,
  toOpml,
  type Outline,
} from "../index";

const p = (text: string) => ({ type: "paragraph", content: [{ type: "text", text }] });
const scene = (attrs: Record<string, unknown>, ...text: string[]) => ({
  type: "scene",
  attrs,
  content: text.map(p),
});

const doc1 = {
  type: "doc",
  content: [
    p("Prose outside any scene."),
    scene(
      {
        id: "sc-1",
        title: "The storm",
        synopsis: "Ana runs.\n\nHe follows.",
        pov: "Ana",
        status: "draft",
        label: "act1",
        target: 1500,
        date: "2024-05-01T08:30",
        cast: ["ana", "ghost"],
      },
      "one two three",
    ),
    { type: "blockquote", content: [scene({ id: "sc-2", title: "Nested" }, "four five")] },
  ],
};
const doc2 = { type: "doc", content: [p("No scenes here.")] };

const outline = (): Outline =>
  buildOutline(
    { title: "Book & <Co>", author: "A. Writer" },
    [
      { id: "c1", title: "Chapter One", doc: doc1 },
      { id: "c2", title: "Chapter Two", doc: doc2 },
    ],
    [{ id: "ana", name: "Ana, the Brave" }],
  );

describe("buildOutline", () => {
  it("walks scenes, resolves cast names and counts words", () => {
    const o = outline();
    expect(o.chapters.map((c) => [c.id, c.title, c.scenes.length])).toEqual([
      ["c1", "Chapter One", 2],
      ["c2", "Chapter Two", 0],
    ]);
    const s = o.chapters[0]!.scenes[0]!;
    expect(s).toMatchObject({ id: "sc-1", target: 1500, date: "2024-05-01T08:30", words: 3 });
    expect(s.cast).toEqual([
      { id: "ana", name: "Ana, the Brave" },
      { id: "ghost", name: "ghost" },
    ]);
    expect(o.chapters[0]!.scenes[1]).toMatchObject({
      id: "sc-2",
      title: "Nested",
      target: null,
      date: "",
      cast: [],
    });
    expect(o.chapters[0]!.words).toBe(9);
  });
  it("tolerates odd input and a missing codex", () => {
    const o = buildOutline({ title: "t", author: "" }, [
      { id: "a", title: "A", doc: null },
      {
        id: "b",
        title: "B",
        doc: { type: "doc", content: [null, 3, scene({ id: 5, cast: "x" }, "w")] },
      },
    ]);
    expect(o.chapters[0]!.scenes).toEqual([]);
    expect(o.chapters[1]!.scenes[0]).toMatchObject({ id: "", cast: [], words: 1 });
  });
});

describe("OPML", () => {
  it("writes OPML 2.0 with escaped text and namespaced fields", () => {
    const x = toOpml(outline());
    expect(x).toContain('<opml version="2.0"');
    expect(x).toContain(OPML_NAMESPACE);
    expect(x).toContain("<title>Book &amp; &lt;Co&gt;</title>");
    expect(x).toContain("<ownerName>A. Writer</ownerName>");
    expect(x).toContain('_note="Ana runs.&#10;&#10;He follows."');
    expect(x).toContain('cc:cast="ana ghost"');
    expect(x).toContain('cc:castNames="Ana, the Brave, ghost"');
    expect(x).toContain('<outline text="Chapter Two" cc:id="c2" cc:words="3"/>');
    expect(x).not.toContain("Prose outside");
  });
  it("leaves the author out when there is none and strips characters XML cannot hold", () => {
    const o = buildOutline({ title: "t\u0001", author: "" }, [
      { id: "c", title: 'a"b\tc\r', doc: doc2 },
    ]);
    const x = toOpml(o);
    expect(x).not.toContain("ownerName");
    expect(x).toContain("<title>t</title>");
    expect(x).toContain('text="a&quot;b&#9;c&#13;"');
  });
  it("round trips the structure", () => {
    const back = fromOpml(toOpml(outline()));
    expect(back.warnings).toEqual([]);
    expect(back.chapters).toHaveLength(2);
    expect(back.chapters[0]!.title).toBe("Chapter One");
    expect(back.chapters[0]!.scenes[0]).toEqual({
      id: "sc-1",
      title: "The storm",
      synopsis: "Ana runs.\n\nHe follows.",
      pov: "Ana",
      status: "draft",
      label: "act1",
      target: 1500,
      date: "2024-05-01T08:30",
      castIds: ["ana", "ghost"],
      castNames: [],
    });
    expect(back.chapters[1]!.scenes).toEqual([]);
  });
  it("round trips Unicode and markup characters", () => {
    const o = buildOutline({ title: "t", author: "" }, [
      {
        id: "c",
        title: "Ünï <b> & “q” 日本語 🎭",
        doc: {
          type: "doc",
          content: [scene({ id: "s", title: "x&y\"z'", synopsis: "<![CDATA[ ]]> ]]> &amp;" })],
        },
      },
    ]);
    const back = fromOpml(toOpml(o));
    expect(back.chapters[0]!.title).toBe("Ünï <b> & “q” 日本語 🎭");
    expect(back.chapters[0]!.scenes[0]).toMatchObject({
      title: "x&y\"z'",
      synopsis: "<![CDATA[ ]]> ]]> &amp;",
    });
  });
  it("reads a plain file from another outliner", () => {
    const back = fromOpml(
      `<?xml version="1.0"?><opml version="1.0"><head/><body><outline text="Ch"><outline text="Sc" _note="n"><outline text="deep"><outline text="deeper"/></outline></outline></outline><outline text="Empty"/></body></opml>`,
    );
    expect(back.chapters.map((c) => [c.title, c.scenes.map((s) => s.title)])).toEqual([
      ["Ch", ["Sc"]],
      ["Empty", []],
    ]);
    expect(back.chapters[0]!.scenes[0]!.synopsis).toBe("n");
    expect(back.warnings).toEqual([
      { code: "ignored", message: expect.stringContaining("2 outline") },
    ]);
  });
  it("reads outlines without a text attribute and scenes without attrs", () => {
    expect(fromOpml(`<opml version="2.0"><body><outline/></body></opml>`).chapters).toEqual([
      { title: "", scenes: [] },
    ]);
    const o = buildOutline({ title: "t", author: "" }, [
      { id: "c", title: "C", doc: { type: "doc", content: [{ type: "scene", content: [] }] } },
    ]);
    expect(o.chapters[0]!.scenes[0]!.id).toBe("");
  });
  it("reads an OPML without a body", () => {
    expect(fromOpml(`<opml version="2.0"><head/></opml>`).chapters).toEqual([]);
  });
  it("cleans bad values with warnings", () => {
    const long = "x".repeat(300);
    const back = fromOpml(
      `<opml version="2.0" xmlns:cc="urn:x"><body><outline text="C">` +
        `<outline text="${long}" cc:id="bad id"/>` +
        `<outline text="A" cc:id="dup" cc:status="DRAFT" cc:target="12" cc:date="2024-01-02"/>` +
        `<outline text="B" cc:id="dup" cc:status="nope" cc:target="-1" cc:date="soon"/>` +
        `<outline text="C" cc:target="99999999999"/>` +
        `<outline text="D" cc:cast="a a b c d e f g h i j k l m n o p q r s t u"/>` +
        `</outline></body></opml>`,
    );
    const codes = back.warnings.map((w) => w.code).sort();
    expect(codes).toEqual(
      [
        "bad-date",
        "bad-id",
        "bad-status",
        "bad-target",
        "bad-target",
        "clamped",
        "clamped",
        "duplicate-id",
      ].sort(),
    );
    const [first, a, b, c, d] = back.chapters[0]!.scenes;
    expect(first!.title).toHaveLength(200);
    expect(a).toMatchObject({ id: "dup", status: "draft", target: 12, date: "2024-01-02" });
    expect(b).toMatchObject({ id: "", status: "", target: null, date: "" });
    expect(c!.target).toBeNull();
    expect(d!.castIds).toHaveLength(20);
  });
  it("refuses malformed, non-OPML, DOCTYPE and oversized input", () => {
    const code = (f: () => unknown) => {
      try {
        f();
      } catch (e) {
        return e instanceof OutlineError ? e.code : "other";
      }
      return "none";
    };
    expect(code(() => fromOpml("<opml><body></opml>"))).toBe("malformed");
    expect(code(() => fromOpml("not xml at all"))).toBe("malformed");
    expect(code(() => fromOpml("<html></html>"))).toBe("not-opml");
    expect(code(() => fromOpml('<!DOCTYPE opml [<!ENTITY a "b">]><opml><body/></opml>'))).toBe(
      "malformed",
    );
    expect(code(() => fromOpml(" ".repeat(MAX_OUTLINE_BYTES + 1)))).toBe("too-large");
    const many = "<outline text='c'/>".repeat(MAX_OUTLINE_CHAPTERS + 1);
    expect(code(() => fromOpml(`<opml version="2.0"><body>${many}</body></opml>`))).toBe(
      "too-many",
    );
    const scenes = "<outline text='s'/>".repeat(MAX_OUTLINE_SCENES / 10 + 1);
    const chapters = `<outline text='c'>${scenes}</outline>`.repeat(10);
    expect(code(() => fromOpml(`<opml version="2.0"><body>${chapters}</body></opml>`))).toBe(
      "too-many",
    );
  });
});

describe("Markdown", () => {
  it("writes headings, synopsis and a field line", () => {
    const m = toMarkdown(outline());
    expect(m).toContain(
      "# Chapter One\n\n## The storm\n\nAna runs.\n\nHe follows.\n\n> id: sc-1; pov: Ana;",
    );
    expect(m).toContain("cast: Ana\\, the Brave, ghost; words: 3");
    expect(m).toContain("## Nested\n\n> id: sc-2; words: 2");
    expect(m).not.toContain("Prose outside");
    expect(toMarkdown({ title: "", author: "", chapters: [] })).toBe("");
  });
  it("round trips the structure, including text that looks like markup", () => {
    const o = buildOutline(
      { title: "t", author: "" },
      [
        {
          id: "c",
          title: "A # B",
          doc: {
            type: "doc",
            content: [
              scene(
                {
                  id: "s1",
                  title: "",
                  synopsis: "# not a heading\n> not fields\n\\ slash\n\\# keep",
                  pov: "A; B\\C",
                  cast: ["x", "y"],
                },
                "w",
              ),
              scene(
                { id: "s2", title: "Ünï 日本語", synopsis: "", status: "final", target: 0 },
                "w",
              ),
            ],
          },
        },
        { id: "d", title: "", doc: doc2 },
      ],
      [{ id: "x", name: "A,B; C\\" }],
    );
    const back = fromMarkdown(toMarkdown(o));
    expect(back.warnings).toEqual([]);
    expect(back.chapters.map((c) => c.title)).toEqual(["A # B", ""]);
    const [s1, s2] = back.chapters[0]!.scenes;
    expect(s1).toMatchObject({
      id: "s1",
      title: "",
      synopsis: "# not a heading\n> not fields\n\\ slash\n\\# keep",
      pov: "A; B\\C",
      castNames: ["A,B; C\\", "y"],
    });
    expect(s2).toMatchObject({ id: "s2", title: "Ünï 日本語", status: "final", target: 0 });
  });
  it("collapses line breaks in one-line fields", () => {
    const o = buildOutline({ title: "t", author: "" }, [
      {
        id: "c",
        title: "A\nB",
        doc: { type: "doc", content: [scene({ id: "s", title: "T\r\nU", pov: "a\nb" }, "w")] },
      },
    ]);
    const back = fromMarkdown(toMarkdown(o));
    expect(back.chapters[0]!.title).toBe("A B");
    expect(back.chapters[0]!.scenes[0]).toMatchObject({ title: "T U", pov: "a b" });
  });
  it("reads a hand-written outline, with CRLF and a BOM", () => {
    const back = fromMarkdown(
      "\uFEFFpreamble\r\n# Ch\r\n\r\n## S1\r\n\r\nThe synopsis.\r\n\r\n## S2\r\n### deeper\r\nmore\r\n\r\n> target: 5; junk; unknown: 1; status: Revised\r\n",
    );
    expect(back.chapters[0]!.scenes[0]).toMatchObject({ title: "S1", synopsis: "The synopsis." });
    expect(back.chapters[0]!.scenes[1]).toMatchObject({
      title: "S2",
      synopsis: "more",
      target: 5,
      status: "revised",
    });
    expect(back.warnings).toHaveLength(1);
    expect(back.warnings[0]!.message).toContain("2 line");
  });
  it("leaves out scenes and text that have no chapter, and notes under a chapter heading", () => {
    const back = fromMarkdown("## orphan\ntext\n# C\nnote\n## S\n");
    expect(back.chapters).toEqual([
      {
        title: "C",
        scenes: [
          {
            id: "",
            title: "S",
            synopsis: "",
            pov: "",
            status: "",
            label: "",
            target: null,
            date: "",
            castIds: [],
            castNames: [],
          },
        ],
      },
    ]);
    expect(back.warnings).toHaveLength(1);
  });
  it("reads empty input and refuses oversized or over-long files", () => {
    expect(fromMarkdown("")).toEqual({ chapters: [], warnings: [] });
    expect(() => fromMarkdown("x".repeat(MAX_OUTLINE_BYTES + 1))).toThrow(OutlineError);
    expect(() => fromMarkdown("# c\n".repeat(MAX_OUTLINE_CHAPTERS + 1))).toThrow(OutlineError);
    expect(() => fromMarkdown(`# c\n${"## s\n".repeat(MAX_OUTLINE_SCENES + 1)}`)).toThrow(/scenes/);
  });
  it("a hand-written line ending in a backslash and plain lines survive", () => {
    const back = fromMarkdown("# C\n## S\na \\\nb\\x\n");
    expect(back.chapters[0]!.scenes[0]!.synopsis).toBe("a \\\nb\\x");
  });
});

describe("CSV", () => {
  it("writes one row per scene and one per empty chapter", () => {
    const rows = toCsv(outline()).replace(/^\uFEFF/, "").split("\r\n");
    expect(rows[0]).toBe(CSV_COLUMNS.join(","));
    expect(rows).toHaveLength(5);
    expect(rows[1]).toContain(
      '1,Chapter One,1,sc-1,The storm,"Ana runs.\n\nHe follows.",Ana,draft,act1,1500,3,2024-05-01T08:30,"Ana, the Brave; ghost"',
    );
    expect(rows[3]).toBe("2,Chapter Two,,,,,,,,,,,");
    expect(toCsv(outline()).startsWith("\uFEFF")).toBe(true);
  });
  it("quotes quotes and neutralises formulas", () => {
    const o = buildOutline({ title: "t", author: "" }, [
      {
        id: "c",
        title: "=SUM(A1)",
        doc: {
          type: "doc",
          content: [
            scene({ id: "s", title: 'say "hi"', synopsis: "+1\t", pov: "@x", label: "-2" }, "w"),
          ],
        },
      },
    ]);
    const csv = toCsv(o);
    expect(csv).toContain("'=SUM(A1)");
    expect(csv).toContain('"say ""hi"""');
    expect(csv).toContain("'+1\t");
    expect(csv).toContain("'@x,");
    expect(csv).toContain("'-2");
  });
});

describe("serializeOutline", () => {
  it("picks the writer and file name for each format", () => {
    const o = outline();
    expect(serializeOutline(o, "opml")).toBe(toOpml(o));
    expect(serializeOutline(o, "markdown")).toBe(toMarkdown(o));
    expect(serializeOutline(o, "csv")).toBe(toCsv(o));
    expect(OUTLINE_FORMATS.opml.file).toBe("outline.opml");
  });
});
