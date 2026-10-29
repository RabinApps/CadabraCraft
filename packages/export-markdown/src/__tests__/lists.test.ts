import { describe, expect, it } from "vitest";
import { assertChapterDoc } from "@cadabracraft/editor-schema";
import { importMarkdown } from "@cadabracraft/import-docx";
import type { ChapterDoc, DocNode, Mark } from "@cadabracraft/shared";
import { MarkdownExportError, chapterToMarkdown } from "../index";

const t = (text: string, ...marks: Mark[]): DocNode =>
  marks.length ? { type: "text", text, marks } : { type: "text", text };
const p = (...content: DocNode[]): DocNode => ({ type: "paragraph", content });
const doc = (...content: DocNode[]): ChapterDoc => ({ type: "doc", content });
const md = (...content: DocNode[]): string => chapterToMarkdown(doc(...content));
const task = (checked: boolean | undefined, ...content: DocNode[]): DocNode => ({
  type: "taskItem",
  ...(checked === undefined ? {} : { attrs: { checked } }),
  content,
});
const tasks = (...items: DocNode[]): DocNode => ({ type: "taskList", content: items });
const term = (...content: DocNode[]): DocNode => ({ type: "definitionTerm", content });
const desc = (...content: DocNode[]): DocNode => ({ type: "definitionDescription", content });
const defs = (...content: DocNode[]): DocNode => ({ type: "definitionList", content });

/** doc -> markdown -> importer: no warnings, valid in the schema, and the same document (a heading is added to start a chapter). */
function roundTrip(d: ChapterDoc): ChapterDoc {
  const out = importMarkdown(chapterToMarkdown(d));
  expect(out.warnings.filter((w) => w.code !== "no-headings")).toEqual([]);
  const back = {
    type: "doc" as const,
    content: out.chapters.flatMap((c) => c.doc.content),
  };
  assertChapterDoc(back);
  return back;
}

describe("task lists", () => {
  it("writes GFM checkboxes", () => {
    expect(
      md(tasks(task(true, p(t("done"))), task(false, p(t("todo"))), task(undefined, p(t("x"))))),
    ).toBe("- [x] done\n- [ ] todo\n- [ ] x\n");
  });
  it("nests, and holds further blocks under an item", () => {
    const out = md(
      tasks(
        task(false, p(t("a")), tasks(task(true, p(t("b")))), p(t("more"))),
        task(true, p(t("c")), {
          type: "bulletList",
          content: [{ type: "listItem", content: [p(t("d"))] }],
        }),
      ),
    );
    expect(out).toBe("- [ ] a\n  - [x] b\n\n  more\n- [x] c\n  - d\n");
  });
  it("gives an empty item a no-break space and alternates the marker after a bullet list", () => {
    expect(md(tasks(task(false, p())))).toBe("- [ ] &nbsp;\n");
    const after = md(
      { type: "bulletList", content: [{ type: "listItem", content: [p(t("x"))] }] },
      tasks(task(false, p(t("y")))),
    );
    expect(after).toBe("- x\n\n* [ ] y\n");
    expect(md(tasks(task(false, p(t("y")))), tasks(task(true, p(t("z")))))).toBe(
      "- [ ] y\n\n* [x] z\n",
    );
  });
  it("round-trips", () => {
    const d = doc(
      tasks(
        task(true, p(t("done")), tasks(task(false, p(t("inner"))))),
        task(false, p(t("todo "), t("bold", m("bold")))),
      ),
    );
    expect(roundTrip(d)).toEqual(d);
  });
  it("keeps a literal [ ] in a paragraph from becoming a checkbox", () => {
    const d = doc({
      type: "bulletList",
      content: [{ type: "listItem", content: [p(t("[ ] not a task"))] }],
    });
    expect(roundTrip(d)).toEqual(d);
  });
  it("throws on a bad item, a bad checked value and an item that does not start with a paragraph", () => {
    expect(() => md({ type: "taskList", content: [p(t("x"))] })).toThrow(/in a list: paragraph/);
    expect(() =>
      md(tasks({ type: "taskItem", attrs: { checked: "yes" as never }, content: [p(t("x"))] })),
    ).toThrow(/checked value/);
    expect(() => md(tasks(task(false, { type: "sceneBreak" })))).toThrow(/start with a paragraph/);
    expect(() => md(tasks({ type: "taskItem" }))).toThrow(MarkdownExportError);
  });
});

function m(type: Mark["type"]): Mark {
  return { type };
}

describe("definition lists", () => {
  it("writes a term line and ': ' description lines", () => {
    expect(
      md(
        defs(
          term(t("Apple")),
          desc(p(t("A fruit"))),
          desc(p(t("Round")), p(t("Red"))),
          term(t("Pear", m("italic"))),
          desc(p(t("Another"))),
        ),
      ),
    ).toBe("Apple\n:   A fruit\n:   Round\n:   Red\n\n*Pear*\n:   Another\n");
  });
  it("writes several terms in a row and keeps blank text readable", () => {
    expect(md(defs(term(t("A")), term(t("B")), desc(p(t("both")))))).toBe("A\nB\n:   both\n");
    expect(md(defs(term(), desc(p())))).toBe("&nbsp;\n:   &nbsp;\n");
    expect(md(defs(term(t("A")), desc(p(t("x")), p())))).toBe("A\n:   x\n");
  });
  it("escapes a paragraph that would read as a description", () => {
    expect(md(p(t(": not a definition")))).toBe("\\: not a definition\n");
  });
  it("round-trips, including a paragraph that starts with a colon right after a term-like paragraph", () => {
    const d = doc(
      p(t("Intro")),
      defs(
        term(t("Apple")),
        term(t("Pomme")),
        desc(p(t("A "), t("fruit", m("bold")))),
        desc(p(t("Round"))),
        term(t("Pear")),
        desc(p(t("Another"))),
      ),
      p(t(": looks like a description")),
    );
    expect(roundTrip(d)).toEqual(d);
  });
  it("throws for what Markdown cannot hold", () => {
    expect(() => md(defs(term(t("a")), desc({ type: "bulletList", content: [] })))).toThrow(
      /start with a paragraph/,
    );
    expect(() => md(defs(term(t("a")), desc(p(t("x")), { type: "sceneBreak" })))).toThrow(
      /paragraphs only/,
    );
    expect(() => md(defs(term(t("a")), desc(p(t("x"), { type: "hardBreak" }, t("y")))))).toThrow(
      /hard break/,
    );
    expect(() => md(defs(term(t("a"), { type: "hardBreak" }, t("b")), desc(p(t("x")))))).toThrow(
      /hard break/,
    );
    expect(() => md(defs(p(t("x"))))).toThrow(/definition list: paragraph/);
    expect(() => md(defs(term(t("a")), { type: "definitionDescription" }))).toThrow(
      /start with a paragraph/,
    );
    expect(() => md(defs())).toThrow(/without entries/);
    expect(() => md({ type: "definitionList" })).toThrow(/without entries/);
  });
});
