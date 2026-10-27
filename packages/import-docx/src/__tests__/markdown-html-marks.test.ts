import { describe, expect, it } from "vitest";
import { chapterDocProblem } from "@cadabracraft/editor-schema";
import type { DocNode } from "@cadabracraft/shared";
import { importMarkdown } from "..";

const doc = (md: string) => {
  const r = importMarkdown(md);
  const d = { type: "doc", content: r.chapters.flatMap((c) => c.doc.content) };
  expect(chapterDocProblem(d), md).toBeNull();
  return { content: d.content as DocNode[], warnings: r.warnings };
};
/** [text, mark types] for every text node of the first paragraph-like block. */
const runs = (md: string): [string, string[]][] => {
  const first = doc(md).content[0] as { content?: { type: string; text?: string; marks?: { type: string }[] }[] };
  return (first.content ?? []).filter((n) => n.type === "text").map((n) => [n.text!, (n.marks ?? []).map((m) => m.type)]);
};
const codes = (md: string) => doc(md).warnings.map((w) => w.code);

describe("inline HTML marks in Markdown", () => {
  it("crossed tags still produce each mark over exactly its own text", () => {
    expect(runs("<u>a<sup>b</u>c</sup>")).toEqual([
      ["a", ["underline"]],
      ["b", ["underline", "superscript"]],
      ["c", ["superscript"]],
    ]);
    expect(codes("<u>a<sup>b</u>c</sup>")).not.toContain("html");
  });

  it("overlapping same-type tags: the inner pair closes first", () => {
    expect(runs("<u>a<u>b</u>c</u>")).toEqual([["abc", ["underline"]]]);
  });

  it("unclosed or unopened tags stay literal text with an html warning", () => {
    expect(runs("<u>never closed")).toEqual([["<u>never closed", []]]);
    expect(runs("never opened</u>")).toEqual([["never opened</u>", []]]);
    expect(codes("<u>never closed")).toContain("html");
    expect(runs("<u>a</u> and <sup>b")).toEqual([["a", ["underline"]], [" and <sup>b", []]]);
  });

  it("an unclosed tag does not leak into the next paragraph", () => {
    const d = doc("<u>open\n\nnext paragraph").content as { content: { text: string; marks?: unknown[] }[] }[];
    expect(d[1]!.content[0]).toEqual({ type: "text", text: "next paragraph" });
  });

  it("sup and sub together keep only the inner one (the schema excludes the pair)", () => {
    expect(runs("<sup>a<sub>b</sub>c</sup>")).toEqual([
      ["a", ["superscript"]],
      ["b", ["subscript"]],
      ["c", ["superscript"]],
    ]);
    expect(runs("<sup><sub>x</sup></sub>").every(([, m]) => m.length <= 1)).toBe(true);
  });

  it("is case-insensitive, rejects attributes (except the small-caps class) and self-closing forms", () => {
    expect(runs("<U>a</U> <SUP>b</SUP> <SPAN CLASS=\"small-caps\">c</SPAN>")).toEqual([
      ["a", ["underline"]],
      [" ", []],
      ["b", ["superscript"]],
      [" ", []],
      ["c", ["smallCaps"]],
    ]);
    expect(codes("<u class='x'>a</u>")).toContain("html");
    expect(codes("<u/>a</u>")).toContain("html");
    expect(codes('<span class="other">a</span>')).toContain("html");
    expect(runs("<span style='font-variant:small-caps'>a</span>")[0]![0]).toContain("<span");
  });

  it("html comments and other tags stay literal and never become marks", () => {
    const r = runs("a <!-- c --> b <br> c <b>x</b>");
    expect(r.flatMap(([, m]) => m)).toEqual([]);
    expect(r.map(([t]) => t).join("")).toContain("<!-- c -->");
  });

  it("nests inside emphasis, strong, links, headings, table cells and footnotes", () => {
    expect(runs("*a <u>b</u> c*")).toEqual([
      ["a ", ["italic"]],
      ["b", ["italic", "underline"]],
      [" c", ["italic"]],
    ]);
    expect(runs("<u>**b**</u>")).toEqual([["b", ["bold", "underline"]]]);
    expect(runs("[<u>l</u>](http://x.com)")).toEqual([["l", ["link", "underline"]]]);
    expect(runs("<u>[l](http://x.com)</u>")).toEqual([["l", ["link", "underline"]]]);
    expect(runs("# H<sup>2</sup>O")).toEqual([["H", []], ["2", ["superscript"]], ["O", []]]);
    const table = doc("| a | b |\n|---|---|\n| <u>x</u> | H<sub>2</sub>O |\n").content[0]!;
    expect(JSON.stringify(table)).toContain('"marks":[{"type":"underline"}]');
    expect(JSON.stringify(table)).toContain('"subscript"');
    const note = doc("t[^1]\n\n[^1]: note <sup>x</sup> and *e*\n").content[0]!;
    expect(chapterDocProblem({ type: "doc", content: [note] })).toBeNull();
    expect(JSON.stringify(note)).toContain("superscript");
  });

  it("a pair that straddles an emphasis boundary is not paired (each side is literal)", () => {
    expect(runs("*a <u>b* c</u>").map(([t]) => t).join("")).toBe("a <u>b c</u>");
    expect(codes("*a <u>b* c</u>")).toContain("html");
  });

  it("inline code and code blocks keep HTML text literal", () => {
    expect(runs("`<u>x</u>`")).toEqual([["<u>x</u>", ["code"]]]);
    const d = doc("```\n<u>x</u>\n```\n").content[0]!;
    expect(d.type).toBe("codeBlock");
  });

  it("thousands of tags in one paragraph stay fast and valid", () => {
    const t0 = performance.now();
    const md = "<u>a</u>".repeat(50_000) + " " + "<sup>".repeat(20_000) + "x" + "</sup>".repeat(20_000);
    const d = doc(md);
    expect(d.content.length).toBe(1);
    expect(performance.now() - t0).toBeLessThan(6000);
  });
});
