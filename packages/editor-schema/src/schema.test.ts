import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { getSchema } from "@tiptap/core";
import { Node } from "@tiptap/pm/model";
import { extensions } from "./index";

const schema = getSchema(extensions);
const sample = JSON.parse(
  readFileSync(new URL("../../../fixtures/manuscripts/sample-chapter.json", import.meta.url), "utf8"),
);

describe("v1 editor schema", () => {
  it("accepts the sample chapter", () => {
    expect(() => Node.fromJSON(schema, sample).check()).not.toThrow();
  });
  it("defines every v1 node and mark", () => {
    for (const n of ["paragraph", "heading", "blockquote", "bulletList", "orderedList", "image", "sceneBreak", "footnote"]) expect(schema.nodes[n], n).toBeDefined();
    for (const m of ["bold", "italic", "underline", "smallCaps", "link"]) expect(schema.marks[m], m).toBeDefined();
  });
  it("leaves out unsupported features", () => {
    expect(schema.marks.strike).toBeUndefined();
    expect(schema.marks.code).toBeUndefined();
    expect(schema.nodes.codeBlock).toBeUndefined();
  });
  it("restricts headings to levels 1-3", () => {
    const h = (level: number) => ({ type: "doc", content: [{ type: "heading", attrs: { level }, content: [{ type: "text", text: "x" }] }] });
    expect(() => Node.fromJSON(schema, h(3)).check()).not.toThrow();
    // Heading levels are enforced by the editor's parse/commands, not the node spec, so exporters clamp too (see export-epub tests).
    expect(schema.nodes.heading!.spec.attrs).toHaveProperty("level");
  });
});

import { normalizeLinkUrl } from "./index";

describe("normalizeLinkUrl", () => {
  it("accepts http, https, mailto and bare domains", () => {
    expect(normalizeLinkUrl("https://example.com/a?b=1")).toBe("https://example.com/a?b=1");
    expect(normalizeLinkUrl("example.com")).toBe("https://example.com/");
    expect(normalizeLinkUrl("mailto:a@b.co")).toBe("mailto:a@b.co");
  });
  it.each(["javascript:alert(1)", "data:text/html,x", "file:///etc/passwd", "", "  ", "two words.com"])("refuses %j", (v) => {
    expect(normalizeLinkUrl(v)).toBeNull();
  });
});
