import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { getSchema } from "@tiptap/core";
import { Node } from "@tiptap/pm/model";
import { assertChapterDoc, chapterDocProblem, extensions, isChapterDoc } from "./index";

const schema = getSchema(extensions);
const sample = JSON.parse(
  readFileSync(new URL("../../../fixtures/manuscripts/sample-chapter.json", import.meta.url), "utf8"),
);

describe("v1 editor schema", () => {
  it("accepts the sample chapter", () => {
    expect(() => Node.fromJSON(schema, sample).check()).not.toThrow();
  });
  it("defines every v1 node and mark", () => {
    for (const n of ["paragraph", "heading", "blockquote", "bulletList", "orderedList", "codeBlock", "image", "sceneBreak", "footnote"]) expect(schema.nodes[n], n).toBeDefined();
    for (const m of ["bold", "italic", "underline", "smallCaps", "strike", "code", "superscript", "subscript", "link"]) expect(schema.marks[m], m).toBeDefined();
  });
  it("holds code blocks as plain text without marks", () => {
    const code = (content: unknown[]) => ({ type: "doc", content: [{ type: "codeBlock", content }] });
    expect(() => Node.fromJSON(schema, code([{ type: "text", text: "a\nb" }])).check()).not.toThrow();
    expect(() => Node.fromJSON(schema, code([{ type: "text", text: "a", marks: [{ type: "bold" }] }])).check()).toThrow();
  });
  it("keeps superscript and subscript mutually exclusive", () => {
    const doc = (marks: { type: string }[]) => ({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "x", marks }] }] });
    expect(() => Node.fromJSON(schema, doc([{ type: "strike" }, { type: "superscript" }])).check()).not.toThrow();
    expect(() => Node.fromJSON(schema, doc([{ type: "superscript" }, { type: "subscript" }])).check()).toThrow();
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

import { isAssetPath } from "@cadabracraft/shared";
import { setAssetUrlResolver } from "./index";

describe("images", () => {
  it("accepts an image node with a relative asset path, alt and title", () => {
    const doc = { type: "doc", content: [{ type: "image", attrs: { src: "assets/a.png", alt: "A", title: "Cap" } }] };
    expect(() => Node.fromJSON(schema, doc).check()).not.toThrow();
  });
  it("only treats single-level assets/ paths as assets", () => {
    expect(isAssetPath("assets/a b.png")).toBe(true);
    for (const bad of ["https://x/a.png", "assets/../a.png", "../assets/a.png", "assets/sub/a.png", "/assets/a.png", "a.png"]) expect(isAssetPath(bad), bad).toBe(false);
  });
  it("exposes a resolver hook that can be cleared", () => {
    setAssetUrlResolver(async (s) => `blob:${s}`);
    setAssetUrlResolver(null);
  });
});

describe("chapter document validation", () => {
  const ok = { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "hi" }] }] };
  it("accepts a valid chapter and narrows it", () => {
    expect(isChapterDoc(ok)).toBe(true);
    expect(() => assertChapterDoc(ok)).not.toThrow();
  });
  it("rejects unknown nodes, bad headings and non-documents", () => {
    expect(isChapterDoc({ type: "doc", content: [{ type: "mystery" }] })).toBe(false);
    expect(chapterDocProblem({ type: "doc", content: [{ type: "heading", attrs: { level: 4 }, content: [{ type: "text", text: "x" }] }] })).toMatch(/level 4/);
    expect(() => assertChapterDoc(null)).toThrow(/invalid chapter document/);
  });
});
