import { describe, expect, it } from "vitest";
import { chapterDocProblem } from "@cadabracraft/editor-schema";
import type { DocNode } from "@cadabracraft/shared";
import { importMarkdown } from "..";
import { budget, cpuClock } from "./helpers";

const doc = (md: string) => {
  const r = importMarkdown(md);
  const d = { type: "doc", content: r.chapters.flatMap((c) => c.doc.content) };
  expect(chapterDocProblem(d), md).toBeNull();
  return { content: d.content as DocNode[], warnings: r.warnings };
};
/** [text, mark types] for every text node of the first paragraph-like block. */
const runs = (md: string): [string, string[]][] => {
  const first = doc(md).content[0] as {
    content?: { type: string; text?: string; marks?: { type: string }[] }[];
  };
  return (first.content ?? [])
    .filter((n) => n.type === "text")
    .map((n) => [n.text!, (n.marks ?? []).map((m) => m.type)]);
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
    expect(runs("<u>a</u> and <sup>b")).toEqual([
      ["a", ["underline"]],
      [" and <sup>b", []],
    ]);
  });

  it("an unclosed tag does not leak into the next paragraph", () => {
    const d = doc("<u>open\n\nnext paragraph").content as {
      content: { text: string; marks?: unknown[] }[];
    }[];
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
    expect(runs('<U>a</U> <SUP>b</SUP> <SPAN CLASS="small-caps">c</SPAN>')).toEqual([
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
    expect(runs("# H<sup>2</sup>O")).toEqual([
      ["H", []],
      ["2", ["superscript"]],
      ["O", []],
    ]);
    const table = doc("| a | b |\n|---|---|\n| <u>x</u> | H<sub>2</sub>O |\n").content[0]!;
    expect(JSON.stringify(table)).toContain('"marks":[{"type":"underline"}]');
    expect(JSON.stringify(table)).toContain('"subscript"');
    const note = doc("t[^1]\n\n[^1]: note <sup>x</sup> and *e*\n").content[0]!;
    expect(chapterDocProblem({ type: "doc", content: [note] })).toBeNull();
    expect(JSON.stringify(note)).toContain("superscript");
  });

  it("a pair that straddles an emphasis boundary is not paired (each side is literal)", () => {
    expect(
      runs("*a <u>b* c</u>")
        .map(([t]) => t)
        .join(""),
    ).toBe("a <u>b c</u>");
    expect(codes("*a <u>b* c</u>")).toContain("html");
  });

  it("inline code and code blocks keep HTML text literal", () => {
    expect(runs("`<u>x</u>`")).toEqual([["<u>x</u>", ["code"]]]);
    const d = doc("```\n<u>x</u>\n```\n").content[0]!;
    expect(d.type).toBe("codeBlock");
  });

  describe("span lang", () => {
    /** [text, lang values] for every text node of the first block. */
    const langs = (md: string): [string, string[]][] => {
      const first = doc(md).content[0] as {
        content?: {
          type: string;
          text?: string;
          marks?: { type: string; attrs?: { lang?: string } }[];
        }[];
      };
      return (first.content ?? [])
        .filter((n) => n.type === "text")
        .map((n) => [
          n.text!,
          (n.marks ?? []).filter((m) => m.type === "lang").map((m) => m.attrs!.lang!),
        ]);
    };

    it("reads a language span as a lang mark, with either quote style", () => {
      expect(langs('Il a dit <span lang="fr">bonjour</span> hier')).toEqual([
        ["Il a dit ", []],
        ["bonjour", ["fr"]],
        [" hier", []],
      ]);
      expect(langs("<span lang='pt-BR'>olá</span>")).toEqual([["olá", ["pt-BR"]]]);
      expect(codes('<span lang="fr">x</span>')).not.toContain("html");
    });

    it("is case-insensitive in the tag and the attribute name", () => {
      expect(langs('<SPAN LANG="de">hallo</SPAN>')).toEqual([["hallo", ["de"]]]);
      expect(langs('<Span  Lang = "es" >hola</Span>')).toEqual([["hola", ["es"]]]);
    });

    it("an invalid tag stays literal text with an html warning", () => {
      for (const bad of [
        '<span lang="">x</span>',
        '<span lang="f r">x</span>',
        `<span lang="${"a".repeat(36)}">x</span>`,
        '<span lang="-fr">x</span>',
        "<span lang=fr>x</span>",
        '<span lang="fr" class="x">x</span>',
        '<span lang="fr" lang="de">x</span>',
        "<span>x</span>",
      ]) {
        expect(codes(bad), bad).toContain("html");
        expect(runs(bad)[0]![0], bad).toContain("<span");
      }
    });

    it("nests with other marks and with small-caps spans, closing in order", () => {
      expect(runs('<span lang="fr">a *b* c</span>')).toEqual([
        ["a ", ["lang"]],
        ["b", ["lang", "italic"]],
        [" c", ["lang"]],
      ]);
      expect(runs('<span lang="fr">a<span class="small-caps">b</span>c</span>')).toEqual([
        ["a", ["lang"]],
        ["b", ["lang", "smallCaps"]],
        ["c", ["lang"]],
      ]);
      expect(runs('<span class="small-caps">a<span lang="fr">b</span>c</span>')).toEqual([
        ["a", ["smallCaps"]],
        ["b", ["lang", "smallCaps"]],
        ["c", ["smallCaps"]],
      ]);
      expect(
        langs('<span lang="fr">a<span lang="de">b</span>c</span>')
          .map(([t]) => t)
          .join(""),
      ).toBe("abc");
    });

    it("crossing a lang span and a small-caps span closes the nearest open span first", () => {
      const r = runs('<span lang="fr">a<span class="small-caps">b</span>c</span> d');
      expect(r.map(([t]) => t).join("")).toBe("abc d");
      expect(codes('<span lang="fr">a<span class="small-caps">b</span>c</span>')).not.toContain(
        "html",
      );
      // Crossed with another tag: each mark covers its own text.
      expect(runs('<span lang="fr">a<u>b</span>c</u>')).toEqual([
        ["a", ["lang"]],
        ["b", ["lang", "underline"]],
        ["c", ["underline"]],
      ]);
    });

    it("an unclosed language span stays literal", () => {
      expect(runs('<span lang="fr">never closed')).toEqual([['<span lang="fr">never closed', []]]);
      expect(codes('<span lang="fr">never closed')).toContain("html");
    });

    it("thousands of language spans stay fast and valid", () => {
      const elapsed = cpuClock();
      const md =
        '<span lang="fr">a</span>'.repeat(40_000) +
        " " +
        '<span lang="de">'.repeat(20_000) +
        "x" +
        "</span>".repeat(20_000);
      expect(doc(md).content.length).toBe(1);
      expect(elapsed()).toBeLessThan(budget(6000));
    });
  });

  it("thousands of tags in one paragraph stay fast and valid", () => {
    const elapsed = cpuClock();
    const md =
      "<u>a</u>".repeat(50_000) + " " + "<sup>".repeat(20_000) + "x" + "</sup>".repeat(20_000);
    const d = doc(md);
    expect(d.content.length).toBe(1);
    expect(elapsed()).toBeLessThan(budget(6000));
  });
});
