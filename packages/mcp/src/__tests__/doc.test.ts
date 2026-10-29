import { describe, expect, it } from "vitest";
import { docToText } from "../doc";

describe("docToText", () => {
  it("fences code blocks and keeps their lines", () => {
    const doc = {
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "Before" }] },
        {
          type: "codeBlock",
          attrs: { language: "js" },
          content: [{ type: "text", text: "a();\n  b();" }],
        },
        { type: "codeBlock" },
      ],
    };
    expect(docToText(doc)).toBe("Before\n\n```js\na();\n  b();\n```\n\n```\n\n```");
  });

  const p = (text: string) => ({ type: "paragraph", content: [{ type: "text", text }] });

  it("writes task lists as - [ ] / - [x], nesting further blocks and tolerating empty items", () => {
    const doc = {
      type: "doc",
      content: [
        {
          type: "taskList",
          content: [
            { type: "taskItem", attrs: { checked: true }, content: [p("done"), p("more")] },
            { type: "taskItem", attrs: { checked: false }, content: [p("todo")] },
            { type: "taskItem" },
          ],
        },
        { type: "taskList" },
      ],
    };
    expect(docToText(doc)).toBe("- [x] done\n  more\n- [ ] todo");
  });

  it("writes definition lists as a term line then ': ' descriptions, tolerating empty parts", () => {
    const doc = {
      type: "doc",
      content: [
        {
          type: "definitionList",
          content: [
            { type: "definitionTerm", content: [{ type: "text", text: "Apple" }] },
            { type: "definitionDescription", content: [p("A fruit"), p("Round")] },
            { type: "definitionTerm" },
            { type: "definitionDescription" },
          ],
        },
        { type: "definitionList" },
      ],
    };
    expect(docToText(doc)).toBe("Apple\n: A fruit\n  Round");
  });
});
