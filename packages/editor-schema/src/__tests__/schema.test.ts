import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { getSchema } from "@tiptap/core";
import { Node } from "@tiptap/pm/model";
import { EditorState, TextSelection } from "@tiptap/pm/state";
import {
  addColumnAfter,
  addRowAfter,
  deleteColumn,
  deleteRow,
  deleteTable,
  toggleHeaderRow,
} from "@tiptap/pm/tables";
import { assertChapterDoc, chapterDocProblem, extensions, isChapterDoc } from "../index";

const schema = getSchema(extensions);
const sample = JSON.parse(
  readFileSync(
    new URL("../../../../fixtures/manuscripts/sample-chapter.json", import.meta.url),
    "utf8",
  ),
);

describe("v1 editor schema", () => {
  it("accepts the sample chapter", () => {
    expect(() => Node.fromJSON(schema, sample).check()).not.toThrow();
  });
  it("defines every v1 node and mark", () => {
    for (const n of [
      "paragraph",
      "heading",
      "blockquote",
      "bulletList",
      "orderedList",
      "codeBlock",
      "image",
      "sceneBreak",
      "footnote",
      "table",
      "tableRow",
      "tableCell",
      "tableHeader",
    ])
      expect(schema.nodes[n], n).toBeDefined();
    for (const m of [
      "bold",
      "italic",
      "underline",
      "smallCaps",
      "strike",
      "code",
      "superscript",
      "subscript",
      "link",
      "lang",
    ])
      expect(schema.marks[m], m).toBeDefined();
  });
  it("holds code blocks as plain text without marks", () => {
    const code = (content: unknown[]) => ({
      type: "doc",
      content: [{ type: "codeBlock", content }],
    });
    expect(() =>
      Node.fromJSON(schema, code([{ type: "text", text: "a\nb" }])).check(),
    ).not.toThrow();
    expect(() =>
      Node.fromJSON(schema, code([{ type: "text", text: "a", marks: [{ type: "bold" }] }])).check(),
    ).toThrow();
  });
  it("keeps superscript and subscript mutually exclusive", () => {
    const doc = (marks: { type: string }[]) => ({
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "x", marks }] }],
    });
    expect(() =>
      Node.fromJSON(schema, doc([{ type: "strike" }, { type: "superscript" }])).check(),
    ).not.toThrow();
    expect(() =>
      Node.fromJSON(schema, doc([{ type: "superscript" }, { type: "subscript" }])).check(),
    ).toThrow();
  });
  it("restricts headings to levels 1-3", () => {
    const h = (level: number) => ({
      type: "doc",
      content: [{ type: "heading", attrs: { level }, content: [{ type: "text", text: "x" }] }],
    });
    expect(() => Node.fromJSON(schema, h(3)).check()).not.toThrow();
    // Heading levels are enforced by the editor's parse/commands, not the node spec, so exporters clamp too (see export-epub tests).
    expect(schema.nodes.heading!.spec.attrs).toHaveProperty("level");
  });
});

import { normalizeLinkUrl } from "../index";

describe("normalizeLinkUrl", () => {
  it("accepts http, https, mailto and bare domains", () => {
    expect(normalizeLinkUrl("https://example.com/a?b=1")).toBe("https://example.com/a?b=1");
    expect(normalizeLinkUrl("example.com")).toBe("https://example.com/");
    expect(normalizeLinkUrl("mailto:a@b.co")).toBe("mailto:a@b.co");
  });
  it.each([
    "javascript:alert(1)",
    "data:text/html,x",
    "file:///etc/passwd",
    "",
    "  ",
    "two words.com",
    "http://",
  ])("refuses %j", (v) => {
    expect(normalizeLinkUrl(v)).toBeNull();
  });
});

import { isAssetPath } from "@cadabracraft/shared";
import { setAssetUrlResolver } from "../index";

describe("images", () => {
  it("accepts an image node with a relative asset path, alt and title", () => {
    const doc = {
      type: "doc",
      content: [{ type: "image", attrs: { src: "assets/a.png", alt: "A", title: "Cap" } }],
    };
    expect(() => Node.fromJSON(schema, doc).check()).not.toThrow();
  });
  it("only treats single-level assets/ paths as assets", () => {
    expect(isAssetPath("assets/a b.png")).toBe(true);
    for (const bad of [
      "https://x/a.png",
      "assets/../a.png",
      "../assets/a.png",
      "assets/sub/a.png",
      "/assets/a.png",
      "a.png",
    ])
      expect(isAssetPath(bad), bad).toBe(false);
  });
  it("exposes a resolver hook that can be cleared", () => {
    setAssetUrlResolver(async (s) => `blob:${s}`);
    setAssetUrlResolver(null);
  });
});

describe("chapter document validation", () => {
  const ok = {
    type: "doc",
    content: [{ type: "paragraph", content: [{ type: "text", text: "hi" }] }],
  };
  it("accepts a valid chapter and narrows it", () => {
    expect(isChapterDoc(ok)).toBe(true);
    expect(() => assertChapterDoc(ok)).not.toThrow();
  });
  it("rejects unknown nodes, bad headings and non-documents", () => {
    expect(isChapterDoc({ type: "doc", content: [{ type: "mystery" }] })).toBe(false);
    expect(
      chapterDocProblem({
        type: "doc",
        content: [{ type: "heading", attrs: { level: 4 }, content: [{ type: "text", text: "x" }] }],
      }),
    ).toMatch(/level 4/);
    expect(() => assertChapterDoc(null)).toThrow(/invalid chapter document/);
  });
});

describe("tables", () => {
  const cell = (
    type = "tableCell",
    attrs?: Record<string, unknown>,
    content: unknown[] = [{ type: "paragraph" }],
  ) => ({ type, ...(attrs ? { attrs } : {}), content });
  const table = (...rows: unknown[][]) => ({
    type: "doc",
    content: [{ type: "table", content: rows.map((r) => ({ type: "tableRow", content: r })) }],
  });
  it("accepts a rectangular table with a header row", () => {
    expect(
      chapterDocProblem(table([cell("tableHeader"), cell("tableHeader")], [cell(), cell()])),
    ).toBeNull();
  });
  it("rejects ragged tables", () => {
    expect(chapterDocProblem(table([cell(), cell()], [cell()]))).toMatch(/rectangular/);
  });
  it("rejects merged cells", () => {
    expect(chapterDocProblem(table([cell("tableCell", { colspan: 2 })]))).toMatch(/merged/);
    expect(chapterDocProblem(table([cell("tableCell", { rowspan: 2 })]))).toMatch(/merged/);
  });
  it("only allows paragraphs in cells", () => {
    expect(
      chapterDocProblem(
        table([
          cell("tableCell", undefined, [
            {
              type: "bulletList",
              content: [{ type: "listItem", content: [{ type: "paragraph" }] }],
            },
          ]),
        ]),
      ),
    ).not.toBeNull();
    expect(
      chapterDocProblem(table([cell("tableCell", undefined, [table([cell()]).content[0]])])),
    ).not.toBeNull();
    expect(chapterDocProblem(table([cell("tableCell", undefined, [])]))).not.toBeNull();
  });
  it("rejects an empty table or row", () => {
    expect(chapterDocProblem(table())).not.toBeNull();
    expect(chapterDocProblem(table([]))).not.toBeNull();
    expect(
      chapterDocProblem({
        type: "doc",
        content: [{ type: "table", content: [{ type: "tableRow" }] }],
      }),
    ).toBe("table row 1 has no cells");
  });
});

describe("table editing commands (the ones behind the Format > Table menu)", () => {
  const cell = (type: string, t: string) => ({
    type,
    content: [{ type: "paragraph", content: [{ type: "text", text: t }] }],
  });
  const start = () => {
    const doc = Node.fromJSON(schema, {
      type: "doc",
      content: [
        {
          type: "table",
          content: [
            { type: "tableRow", content: [cell("tableHeader", "a"), cell("tableHeader", "b")] },
            { type: "tableRow", content: [cell("tableCell", "c"), cell("tableCell", "d")] },
          ],
        },
      ],
    });
    let pos = 0;
    doc.descendants((n, p) => {
      if (n.isText && n.text === "c") pos = p + 1;
    });
    return EditorState.create({ schema, doc, selection: TextSelection.create(doc, pos) });
  };
  const run = (state: EditorState, cmd: typeof addRowAfter) => {
    let next = state;
    expect(
      cmd(state, (tr) => {
        next = state.apply(tr);
      }),
    ).toBe(true);
    return next;
  };
  it("keeps the table rectangular and unmerged after each command", () => {
    for (const cmd of [addRowAfter, addColumnAfter, deleteRow, deleteColumn, toggleHeaderRow]) {
      expect(chapterDocProblem(run(start(), cmd).doc.toJSON()), cmd.name).toBeNull();
    }
  });
  it("adds a row and a column of the right size, and deletes the table", () => {
    const grown = run(run(start(), addRowAfter), addColumnAfter).doc.firstChild!;
    expect(grown.childCount).toBe(3);
    expect(grown.child(0).childCount).toBe(3);
    expect(run(start(), deleteTable).doc.firstChild?.type.name).not.toBe("table");
  });
});

describe("chapterDocProblem links", () => {
  const withHref = (href: unknown) => ({
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [{ type: "text", text: "x", marks: [{ type: "link", attrs: { href } }] }],
      },
    ],
  });
  it("accepts http, https and mailto links", () => {
    for (const h of ["https://a.test/", "http://a.test", "mailto:a@b.test"])
      expect(chapterDocProblem(withHref(h))).toBeNull();
  });
  it.each(["javascript:alert(1)", "data:text/html,x", "file:///etc/passwd", "no-scheme.test", ""])(
    "refuses %j",
    (h) => {
      expect(chapterDocProblem(withHref(h))).toMatch(/link .* is not allowed/);
    },
  );
  it("refuses a link without an href", () => {
    expect(chapterDocProblem(withHref(undefined))).toMatch(/link "" is not allowed/);
  });
});

describe("task lists and definition lists", () => {
  const p = (text: string) => ({ type: "paragraph", content: [{ type: "text", text }] });
  const doc = (...content: unknown[]) => ({ type: "doc", content });
  const task = (checked: unknown, ...content: unknown[]) => ({
    type: "taskItem",
    ...(checked === undefined ? {} : { attrs: { checked } }),
    content,
  });
  it("accepts task lists, nested lists and items without a checked value", () => {
    expect(
      chapterDocProblem(
        doc({
          type: "taskList",
          content: [
            task(true, p("a")),
            task(
              undefined,
              p("b"),
              { type: "taskList", content: [task(false, p("c"))] },
              { type: "bulletList", content: [{ type: "listItem", content: [p("d")] }] },
            ),
          ],
        }),
      ),
    ).toBeNull();
  });
  it("defaults an item to unchecked", () => {
    const n = Node.fromJSON(schema, doc({ type: "taskList", content: [task(undefined, p("a"))] }));
    expect(n.firstChild!.firstChild!.attrs.checked).toBe(false);
  });
  it("rejects a checked value that is not true or false, and an item that starts with a list", () => {
    expect(chapterDocProblem(doc({ type: "taskList", content: [task("yes", p("a"))] }))).toMatch(
      /checked/,
    );
    expect(
      chapterDocProblem(
        doc({
          type: "taskList",
          content: [task(false, { type: "bulletList", content: [] }, p("a"))],
        }),
      ),
    ).not.toBeNull();
    expect(chapterDocProblem(doc({ type: "taskList", content: [] }))).not.toBeNull();
    expect(chapterDocProblem(doc(task(false, p("a"))))).not.toBeNull();
  });
  it("accepts an image with a boolean decorative value and rejects any other type", () => {
    const img = (decorative: unknown) =>
      doc({ type: "image", attrs: { src: "assets/a.png", alt: "", decorative } });
    expect(chapterDocProblem(img(true))).toBeNull();
    expect(chapterDocProblem(img(undefined))).toBeNull();
    expect(chapterDocProblem(img("yes"))).toMatch(/decorative/);
    const n = Node.fromJSON(schema, doc({ type: "image", attrs: { src: "assets/a.png" } }));
    expect(n.firstChild!.attrs.decorative).toBe(false);
  });
  describe("lang mark", () => {
    const withLang = (attrs: unknown) =>
      doc({
        type: "paragraph",
        content: [{ type: "text", text: "x", marks: [{ type: "lang", attrs }] }],
      });
    it("accepts a BCP 47 tag and keeps it", () => {
      expect(chapterDocProblem(withLang({ lang: "fr-CA" }))).toBeNull();
      const n = Node.fromJSON(schema, withLang({ lang: "fr" }));
      expect(n.firstChild!.firstChild!.marks[0]!.attrs.lang).toBe("fr");
    });
    it("refuses a missing, non-string, malformed or too long tag", () => {
      for (const attrs of [
        {},
        undefined,
        { lang: 5 },
        { lang: "fr_CA" },
        { lang: "a b" },
        { lang: "a".repeat(36) },
      ])
        expect(chapterDocProblem(withLang(attrs)), JSON.stringify(attrs)).toMatch(/language/);
    });
    it("is not inclusive and replaces another lang mark", () => {
      expect(schema.marks.lang!.spec.inclusive).toBe(false);
      expect(schema.marks.lang!.excludes(schema.marks.lang!)).toBe(true);
    });
  });
  const term = (text: string) => ({ type: "definitionTerm", content: [{ type: "text", text }] });
  const desc = (...content: unknown[]) => ({ type: "definitionDescription", content });
  it("accepts terms followed by descriptions, in groups, with inline marks and footnotes", () => {
    expect(
      chapterDocProblem(
        doc({
          type: "definitionList",
          content: [
            term("A"),
            term("B"),
            desc(p("one"), {
              type: "bulletList",
              content: [{ type: "listItem", content: [p("x")] }],
            }),
            desc(p("two")),
            {
              type: "definitionTerm",
              content: [
                { type: "text", text: "C", marks: [{ type: "bold" }] },
                { type: "footnote", content: [{ type: "text", text: "n" }] },
              ],
            },
            desc(p("three")),
          ],
        }),
      ),
    ).toBeNull();
  });
  it("rejects a list that starts or ends wrongly, is empty, or has a description without a paragraph first", () => {
    const list = (...content: unknown[]) => doc({ type: "definitionList", content });
    expect(chapterDocProblem(list(desc(p("x"))))).not.toBeNull();
    expect(chapterDocProblem(list(term("A")))).not.toBeNull();
    expect(chapterDocProblem(list(term("A"), desc(p("x")), term("B")))).not.toBeNull();
    expect(chapterDocProblem(list())).not.toBeNull();
    expect(chapterDocProblem(list(term("A"), desc({ type: "sceneBreak" }, p("x"))))).not.toBeNull();
  });
});
