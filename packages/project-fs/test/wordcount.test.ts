import { describe, expect, it } from "vitest";
import { countWords } from "../src/index";

const p = (...content: object[]) => ({ type: "paragraph", content });
const t = (text: string) => ({ type: "text", text });

describe("countWords (same rules as apps/desktop/src/lib/wordcount.ts)", () => {
  it("counts zero for empty or missing documents", () => {
    expect(countWords(null)).toBe(0);
    expect(countWords({ type: "doc", content: [{ type: "paragraph" }] })).toBe(0);
  });
  it("counts words across blocks without merging block edges", () => {
    const doc = { type: "doc", content: [{ type: "heading", attrs: { level: 1 }, content: [t("Chapter One")] }, p(t("It was")), p(t("late."))] };
    expect(countWords(doc)).toBe(5);
  });
  it("treats marks as part of the same word", () => {
    expect(countWords({ type: "doc", content: [p(t("un"), { type: "text", text: "believ", marks: [{ type: "bold" }] }, t("able"))] })).toBe(1);
  });
  it("separates footnote text from the surrounding words", () => {
    expect(countWords({ type: "doc", content: [p(t("word"), { type: "footnote", content: [t("A note")] }, t("more"))] })).toBe(4);
  });
});
