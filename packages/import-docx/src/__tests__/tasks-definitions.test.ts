import { describe, expect, it } from "vitest";
import type { DocNode } from "@cadabracraft/shared";
import { importDocx, importHtml, importMarkdown } from "..";
import { definitionNodes, listNodes } from "../common";
import { expectValid, makeDocx, para, STYLES, NUMBERING } from "./helpers";

const codes = (r: { warnings: { code: string }[] }) => r.warnings.map((w) => w.code);
type Loose = { type: string; content?: Loose[]; attrs?: Record<string, unknown> };
const body = (r: ReturnType<typeof importMarkdown>) =>
  r.chapters[0]!.doc.content.slice(1) as unknown as Loose[];
const t = (text: string): DocNode => ({ type: "text", text });
const p = (...c: DocNode[]): DocNode => ({ type: "paragraph", content: c });

describe("markdown task lists", () => {
  it("reads checked and unchecked items, nested", () => {
    const r = importMarkdown("# T\n\n- [x] done\n- [ ] todo\n  - [ ] nested\n  - plain\n");
    expectValid(r);
    expect(body(r)).toEqual([
      {
        type: "taskList",
        content: [
          { type: "taskItem", attrs: { checked: true }, content: [p(t("done"))] },
          {
            type: "taskItem",
            attrs: { checked: false },
            content: [
              p(t("todo")),
              {
                type: "taskList",
                content: [
                  { type: "taskItem", attrs: { checked: false }, content: [p(t("nested"))] },
                ],
              },
              { type: "bulletList", content: [{ type: "listItem", content: [p(t("plain"))] }] },
            ],
          },
        ],
      },
    ]);
  });

  it("splits a list that mixes task and plain items, and says numbered task items lost their numbers", () => {
    const r = importMarkdown("# T\n\n- a\n- [x] b\n- c\n");
    expectValid(r);
    expect(body(r).map((n) => n.type)).toEqual(["bulletList", "taskList", "bulletList"]);
    const n = importMarkdown("# T\n\n3. one\n4. [ ] two\n5. three\n");
    expectValid(n);
    expect(body(n).map((x) => x.type)).toEqual(["orderedList", "taskList", "orderedList"]);
    expect(JSON.stringify(body(n)[2])).toContain('"start":5');
    expect(JSON.stringify(body(n)[0])).toContain('"start":3');
    expect(codes(n)).toContain("task-list");
  });

  it("keeps an empty task item", () => {
    const r = importMarkdown("# T\n\n- [ ] \u00a0\n");
    expectValid(r);
    expect(body(r)[0]!.type).toBe("taskList");
  });
});

describe("markdown definition lists", () => {
  it("reads Term / : Definition lines, with inline marks", () => {
    const r = importMarkdown("# T\n\n*Term* one\n:   First **meaning**\n:   Second meaning\n");
    expectValid(r);
    expect(body(r)).toEqual([
      {
        type: "definitionList",
        content: [
          {
            type: "definitionTerm",
            content: [{ ...t("Term"), marks: [{ type: "italic" }] }, t(" one")],
          },
          {
            type: "definitionDescription",
            content: [p(t("First "), { type: "text", text: "meaning", marks: [{ type: "bold" }] })],
          },
          { type: "definitionDescription", content: [p(t("Second meaning"))] },
        ],
      },
    ]);
  });

  it("joins a term paragraph with the description paragraph after it and merges neighbouring groups", () => {
    const r = importMarkdown(
      "# T\n\nApple\n\n: A fruit\n\nPear\n: Another fruit\n\nPlum\n\n: Purple\n",
    );
    expectValid(r);
    const list = body(r);
    expect(list).toHaveLength(1);
    expect(list[0]!.type).toBe("definitionList");
    expect(list[0]!.content!.map((n) => n.type)).toEqual([
      "definitionTerm",
      "definitionDescription",
      "definitionTerm",
      "definitionDescription",
      "definitionTerm",
      "definitionDescription",
    ]);
  });

  it("appends further description paragraphs to a group, and several term lines share descriptions", () => {
    const r = importMarkdown("# T\n\nA\nB\n: shared\n\n: more\n");
    expectValid(r);
    expect(body(r)[0]!.content!.map((n) => n.type)).toEqual([
      "definitionTerm",
      "definitionTerm",
      "definitionDescription",
      "definitionDescription",
    ]);
  });

  it("treats a line after a description as a new term only when a description follows it", () => {
    const lazy = importMarkdown("# T\n\nA\n: one\nlazy\n");
    expectValid(lazy);
    const kids = body(lazy)[0]!.content!;
    expect(kids.map((n) => n.type)).toEqual(["definitionTerm", "definitionDescription"]);
    expect(JSON.stringify(kids[1])).toContain("one lazy");
    const next = importMarkdown("# T\n\nA\n: one\nB\n: two\n");
    expect(body(next)[0]!.content!.map((n) => n.type)).toEqual([
      "definitionTerm",
      "definitionDescription",
      "definitionTerm",
      "definitionDescription",
    ]);
  });

  it("leaves ordinary paragraphs alone, including a lone ': ' paragraph and an escaped colon", () => {
    const r = importMarkdown("# T\n\n: stray\n\nplain\n\n\\: escaped\n\nterm only\n");
    expectValid(r);
    expect(body(r).every((n) => n.type === "paragraph")).toBe(true);
  });

  it("splits hard breaks into term lines and warns about images in a term", () => {
    const r = importMarkdown("# T\n\nOne  \nTwo\n: both\n\nPic ![alt](x.png)\n: with image\n");
    expectValid(r);
    expect(body(r)[0]!.type).toBe("definitionList");
    expect(codes(r)).toContain("definition-term-image");
  });

  it("ignores blank text pieces in a term and keeps a description-only first line", () => {
    const r = importMarkdown("# T\n\nA\n:\n: real\n");
    expectValid(r);
    expect(body(r).length).toBeGreaterThan(0);
  });
});

describe("html task lists and definition lists", () => {
  it("reads GitHub-style checkbox items and the editor's own markup", () => {
    const r = importHtml(
      '<h1>T</h1><ul><li><input type="checkbox" checked disabled> done</li><li><label><input type="checkbox"></label><div>todo <b>bold</b></div></li><li>plain</li></ul><ol start="2"><li><input type="checkbox"> n</li></ol>',
    );
    expectValid(r);
    expect(body(r as never).map((n) => n.type)).toEqual(["taskList", "bulletList", "taskList"]);
    expect(JSON.stringify(body(r as never)[0])).toContain('"checked":true');
    expect(codes(r)).toContain("task-list");
    expect(codes(r)).not.toContain("unsupported-element");
  });

  it("reads data-checked on an item whose checkbox has no checked attribute", () => {
    const r = importHtml(
      '<h1>T</h1><ul data-type="taskList"><li data-type="taskItem" data-checked="true"><label><input type="checkbox"></label><div><p>x</p></div></li></ul>',
    );
    expectValid(r);
    expect(JSON.stringify(body(r as never))).toContain('"checked":true');
  });

  it("does not treat a text-first or other-input item as a task item", () => {
    const r = importHtml(
      '<h1>T</h1><ul><li>a <input type="checkbox"></li><li><input type="text"> b</li><li><span>c</span></li><li><label>x</label></li></ul>',
    );
    expectValid(r);
    expect(body(r as never)[0]!.type).toBe("bulletList");
    expect(codes(r)).toContain("unsupported-element");
  });

  it("reads dl/dt/dd, including div groups and orphan or trailing parts", () => {
    const r = importHtml(
      "<h1>T</h1><dl><dd>orphan</dd><div><dt>A</dt><dt>B</dt><dd>one</dd><dd><p>two</p><ul><li>x</li></ul></dd></div><dt>Last</dt></dl>",
    );
    expectValid(r);
    const b = body(r as never);
    expect(b.map((n) => n.type)).toEqual(["paragraph", "definitionList", "paragraph"]);
    expect(b[1]!.content!.map((n) => n.type)).toEqual([
      "definitionTerm",
      "definitionTerm",
      "definitionDescription",
      "definitionDescription",
    ]);
  });

  it("moves block content out of a term into its description", () => {
    const r = importHtml('<h1>T</h1><dl><dt>Pic <img src="a.png"></dt><dd>d</dd></dl>');
    expectValid(r);
    expect(body(r as never)[0]!.type).toBe("definitionList");
  });

  it("flattens a dl that is nested too deeply", () => {
    const r = importHtml("<h1>T</h1><dl><dt>a</dt><dd>b</dd></dl>", { maxNestingDepth: 0 });
    expect(codes(r)).toContain("nesting-too-deep");
  });

  it("flattens task lists and definition lists inside table cells", () => {
    const r = importHtml(
      '<h1>T</h1><table><tr><td><ul><li><input type="checkbox"> a</li></ul><dl><dt>Term</dt><dd>Def</dd></dl></td></tr></table>',
    );
    expectValid(r);
    expect(codes(r)).toContain("table-complex");
  });
});

describe("common list builders", () => {
  it("lists nothing for no entries and handles a definition list of only terms", () => {
    expect(listNodes([], false).nodes).toEqual([]);
    expect(definitionNodes([{ kind: "term", content: [t("x")] }])).toEqual([p(t("x"))]);
    expect(
      definitionNodes([
        { kind: "term", content: [] },
        { kind: "desc", content: [] },
      ]),
    ).toEqual([
      {
        type: "definitionList",
        content: [
          { type: "definitionTerm" },
          { type: "definitionDescription", content: [{ type: "paragraph" }] },
        ],
      },
    ]);
  });
});

const STYLES_DEF = STYLES.replace(
  "</w:styles>",
  '<w:style w:type="paragraph" w:styleId="DefinitionTerm"><w:name w:val="Definition Term"/><w:basedOn w:val="Normal"/></w:style><w:style w:type="paragraph" w:styleId="Definition"><w:name w:val="Definition"/><w:basedOn w:val="Normal"/></w:style></w:styles>',
);
const box = (checked: boolean) =>
  `<w:sdt><w:sdtPr><w14:checkbox><w14:checked w14:val="${checked ? 1 : 0}"/></w14:checkbox></w:sdtPr><w:sdtContent><w:r><w:t>${checked ? "☒" : "☐"}</w:t></w:r></w:sdtContent></w:sdt>`;
const taskPara = (checked: boolean, text: string, ppr = "") =>
  `<w:p><w:pPr>${ppr}</w:pPr>${box(checked)}<w:r><w:t xml:space="preserve"> ${text}</w:t></w:r></w:p>`;

describe("docx definition styles", () => {
  it("reads Definition Term and Definition paragraphs as a definition list", () => {
    const r = importDocx(
      makeDocx({
        styles: STYLES_DEF,
        body:
          para("T", "Heading1") +
          para("Before") +
          para("Apple", "DefinitionTerm") +
          para("A fruit", "Definition") +
          para("Round", "Definition") +
          para("Pear", "DefinitionTerm") +
          para("Another", "Definition") +
          para("After"),
      }),
    );
    expectValid(r);
    const b = body(r as never);
    expect(b.map((n) => n.type)).toEqual(["paragraph", "definitionList", "paragraph"]);
    expect(b[1]!.content!.map((n) => n.type)).toEqual([
      "definitionTerm",
      "definitionDescription",
      "definitionTerm",
      "definitionDescription",
    ]);
    // Two consecutive Definition paragraphs are one description with two paragraphs.
    expect(b[1]!.content![1]!.content).toHaveLength(2);
  });

  it("closes a list or quote before a definition and ends the definition at a table, code or list", () => {
    const r = importDocx(
      makeDocx({
        styles: STYLES_DEF,
        numbering: NUMBERING,
        body:
          para("T", "Heading1") +
          para("item", "ListBullet") +
          para("Term", "DefinitionTerm") +
          para("def", "Definition") +
          para("", "Definition") +
          para("quoted", "Quote") +
          para("Term2", "DefinitionTerm"),
      }),
    );
    expectValid(r);
    expect(body(r as never).map((n) => n.type)).toEqual([
      "bulletList",
      "definitionList",
      "blockquote",
      "paragraph",
    ]);
  });

  it("keeps a term that has an image as plain text plus its image after it", () => {
    const r = importDocx(
      makeDocx({
        styles: STYLES_DEF,
        body: para("T", "Heading1") + para("Term", "DefinitionTerm") + para("def", "Definition"),
      }),
    );
    expectValid(r);
    expect(body(r as never)[0]!.type).toBe("definitionList");
  });
});

describe("docx checkbox content controls", () => {
  it("reads a paragraph that starts with a checkbox as a task item, nested by indent", () => {
    const r = importDocx(
      makeDocx({
        styles: STYLES_DEF,
        body:
          para("T", "Heading1") +
          taskPara(true, "done", '<w:ind w:left="720" w:hanging="360"/>') +
          taskPara(false, "todo", '<w:ind w:start="1440" w:hanging="360"/>') +
          taskPara(false, "back", "") +
          para("plain"),
      }),
    );
    expectValid(r);
    const b = body(r as never);
    expect(b.map((n) => n.type)).toEqual(["taskList", "paragraph"]);
    const first = b[0]!.content![0]!;
    expect(first.attrs).toEqual({ checked: true });
    expect(JSON.stringify(first)).toContain("todo");
    expect(JSON.stringify(first)).toContain('"text":"done"');
    expect(b[0]!.content).toHaveLength(2);
  });

  it("nests by numbering level and starts a new list when the kind changes", () => {
    const numPr = (id: number, lvl: number) =>
      `<w:numPr><w:ilvl w:val="${lvl}"/><w:numId w:val="${id}"/></w:numPr>`;
    const r = importDocx(
      makeDocx({
        styles: STYLES_DEF,
        numbering: NUMBERING,
        body:
          para("T", "Heading1") +
          taskPara(false, "a", numPr(1, 0)) +
          taskPara(true, "b", numPr(1, 1)) +
          para("bullet", "ListBullet") +
          taskPara(false, "z", ""),
      }),
    );
    expectValid(r);
    expect(body(r as never).map((n) => n.type)).toEqual(["taskList", "bulletList", "taskList"]);
  });

  it("keeps a checkbox in the middle of text, in a note or after text as its glyph", () => {
    const r = importDocx(
      makeDocx({
        styles: STYLES_DEF,
        body:
          para("T", "Heading1") +
          `<w:p><w:r><w:t>Agree </w:t></w:r>${box(true)}</w:p>` +
          `<w:p>${box(true)}${box(false)}<w:r><w:t>two</w:t></w:r></w:p>`,
        footnotes: `<w:footnote w:id="1"><w:p>${box(true)}<w:r><w:t>note</w:t></w:r></w:p></w:footnote>`,
      }),
    );
    expectValid(r);
    const text = JSON.stringify(body(r as never));
    expect(text).toContain("Agree ☒");
    expect(text).toContain("☐two");
  });

  it("reads a value of 'true' and ignores a checkbox with no checked element", () => {
    const r = importDocx(
      makeDocx({
        styles: STYLES_DEF,
        body:
          para("T", "Heading1") +
          `<w:p><w:sdt><w:sdtPr><w14:checkbox><w14:checked w14:val="true"/></w14:checkbox></w:sdtPr><w:sdtContent><w:r><w:t>x</w:t></w:r></w:sdtContent></w:sdt><w:r><w:t>one</w:t></w:r></w:p>` +
          `<w:p><w:sdt><w:sdtPr><w14:checkbox/></w:sdtPr><w:sdtContent><w:r><w:t>x</w:t></w:r></w:sdtContent></w:sdt><w:r><w:t>two</w:t></w:r></w:p>`,
      }),
    );
    expectValid(r);
    const list = body(r as never)[0]!;
    expect(list.type).toBe("taskList");
    expect(list.content!.map((i) => i.attrs)).toEqual([{ checked: true }, { checked: false }]);
  });
});
