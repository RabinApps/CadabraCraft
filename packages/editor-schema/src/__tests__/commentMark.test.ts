import { describe, expect, it } from "vitest";
import { chapterDocProblem, Comment, editorSchema } from "../index";

const doc = (attrs: Record<string, unknown>) => ({
  type: "doc",
  content: [
    {
      type: "paragraph",
      content: [{ type: "text", text: "the storm", marks: [{ type: "comment", attrs }] }],
    },
  ],
});

// The extension configs hold plain functions; call them directly so no DOM is needed.
type Fn = (...a: never[]) => unknown;
const cfg = (ext: unknown) => (ext as { config: Record<string, Fn> }).config;
const call = (ext: unknown, key: string, ...args: unknown[]) =>
  (cfg(ext)[key] as unknown as (...a: unknown[]) => unknown)(...args);

describe("the comment mark", () => {
  it("is part of the schema the app and the exporters share", () => {
    expect(Object.keys(editorSchema().marks)).toContain("comment");
  });

  it("stores no thread by default, and only a valid one from HTML", () => {
    const [rule] = call(Comment, "parseHTML") as {
      tag: string;
      getAttrs: (el: unknown) => unknown;
    }[];
    expect(rule!.tag).toBe("span[data-comment]");
    const el = (v: string | null) => ({ getAttribute: () => v });
    expect(rule!.getAttrs(el("t-1"))).toBeNull();
    expect(rule!.getAttrs(el("1 bad"))).toBe(false);
    expect(rule!.getAttrs(el(null))).toBe(false);
    expect(call(Comment, "addAttributes")).toEqual({ id: { default: null } });
    expect(call(Comment, "renderHTML", { HTMLAttributes: { id: "t-1" } })).toEqual([
      "span",
      { "data-comment": "t-1" },
      0,
    ]);
  });

  it("accepts a valid thread id", () => {
    expect(chapterDocProblem(doc({ id: "t-1" }))).toBeNull();
  });

  it("refuses a missing or malformed thread id, naming the value", () => {
    expect(chapterDocProblem(doc({}))).toMatch(/comment "" is not allowed/);
    expect(chapterDocProblem(doc({ id: "1 bad" }))).toMatch(/comment "1 bad" is not allowed/);
    expect(chapterDocProblem(doc({ id: 7 }))).toMatch(/is not allowed/);
  });
});
