import { describe, expect, it } from "vitest";
import type { DocNode } from "@cadabracraft/shared";
import { buildRtf } from "../index";
import { orderedLabel } from "../lists";
import { settleTables } from "../tables";
import {
  t,
  p,
  doc,
  chapter,
  item,
  row,
  cell,
  head,
  table,
  build,
  one,
  message,
  checkRtf,
  book,
} from "./rtfFixtures";

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
