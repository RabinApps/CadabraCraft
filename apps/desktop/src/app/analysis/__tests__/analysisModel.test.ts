import { describe, expect, it } from "vitest";
import type { BookPage } from "../../../state/project/types";
import { analysisView } from "../analysisModel";
import { pagesInScope, reportFor } from "../analysisScope";
import { analyzeBlocks } from "@cadabracraft/shared";

const fmt = (n: number) => String(n);

/** A page whose doc has one paragraph per string. */
const page = (id: string, paragraphs: string[], extra: Partial<BookPage> = {}): BookPage =>
  ({
    id,
    title: id,
    section: "chapter",
    doc: {
      type: "doc",
      content: paragraphs.map((text) => ({
        type: "paragraph",
        content: [{ type: "text", text }],
      })),
    },
    ...extra,
  }) as BookPage;

const GARDEN = "The garden grew. The garden bloomed. The garden faded. The garden slept.";
const MIXED = 'She felt quietly tired. "Hi," she said.';

describe("pagesInScope", () => {
  const pages = [
    page("front", ["Front"], { section: "front" }),
    page("one", ["One"]),
    page("part", ["Part"], { kind: "part" }),
    page("back", ["Back"], { section: "back" }),
  ];

  it("book is the chapters, without front matter, back matter or parts", () => {
    expect(pagesInScope(pages, "book", "one").map((p) => p.id)).toEqual(["one"]);
  });

  it("chapter is the open page, whatever it is", () => {
    expect(pagesInScope(pages, "chapter", "front").map((p) => p.id)).toEqual(["front"]);
    expect(pagesInScope(pages, "chapter", null)).toEqual([]);
  });
});

describe("reportFor", () => {
  it("counts only the open page for the chapter scope", () => {
    const pages = [page("a", [GARDEN]), page("b", [MIXED])];
    expect(reportFor(pages, "chapter", "b").words).toBe(7);
    expect(reportFor(pages, "book", "b").words).toBe(12 + 7);
  });
});

describe("analysisView", () => {
  const report = analyzeBlocks([GARDEN, MIXED]);
  const view = analysisView(report, fmt);

  it("is not blank when there is text", () => {
    expect(view.blank).toBe(false);
  });

  it("draws the summary tiles in order, with Dale-Chall pending", () => {
    expect(view.tiles.map((t) => t.key)).toEqual(["words", "sentences", "flesch", "dale"]);
    expect(view.tiles.find((t) => t.key === "words")?.value).toBe("19");
    expect(view.tiles.find((t) => t.key === "sentences")?.value).toBe("6");
    expect(view.tiles.find((t) => t.key === "dale")?.value).toBeNull();
    expect(view.tiles.find((t) => t.key === "flesch")?.value).not.toBeNull();
  });

  it("lists the seven sections in order", () => {
    expect(view.sections.map((s) => s.key)).toEqual([
      "words",
      "phrases",
      "adverbs",
      "passive",
      "filters",
      "tags",
      "cliches",
    ]);
  });

  it("counts a repeated word, an adverb, a filter word and a dialogue tag", () => {
    const by = (key: string) => view.sections.find((s) => s.key === key)!;
    expect(by("words").found).toBe(1);
    expect(by("words").rows[0]).toMatchObject({ item: "garden", count: 4 });
    expect(by("adverbs").found).toBe(1);
    expect(by("adverbs").rows[0]).toMatchObject({ item: "quietly", count: 1 });
    expect(by("filters").rows[0]).toMatchObject({ count: 1 });
    expect(by("tags").found).toBe(1);
    expect(by("tags").rows.map((r) => r.count)).toEqual([1, 1, 1]);
  });

  it("has no phrases or passive sentences, so their rows are empty", () => {
    const by = (key: string) => view.sections.find((s) => s.key === key)!;
    expect(by("phrases").found).toBe(0);
    expect(by("phrases").rows).toEqual([]);
    expect(by("passive").rows).toEqual([]);
  });

  it("has no word list for clichés yet", () => {
    const cliches = view.sections.find((s) => s.key === "cliches")!;
    expect(cliches.found).toBeNull();
    expect(cliches.rows).toEqual([]);
  });

  it("is blank for a scope with no text", () => {
    expect(analysisView(analyzeBlocks([]), fmt).blank).toBe(true);
  });
});
