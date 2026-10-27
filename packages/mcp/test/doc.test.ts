import { describe, expect, it } from "vitest";
import { docToText } from "../src/doc";

describe("docToText", () => {
  it("fences code blocks and keeps their lines", () => {
    const doc = { type: "doc", content: [
      { type: "paragraph", content: [{ type: "text", text: "Before" }] },
      { type: "codeBlock", attrs: { language: "js" }, content: [{ type: "text", text: "a();\n  b();" }] },
      { type: "codeBlock" },
    ] };
    expect(docToText(doc)).toBe("Before\n\n```js\na();\n  b();\n```\n\n```\n\n```");
  });
});
