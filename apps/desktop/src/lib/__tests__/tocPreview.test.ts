import type { TocItem } from "@cadabracraft/format";
import { describe, expect, it } from "vitest";
import {
  TOC_APPROX_DELAY_MS,
  TOC_TYPST_DELAY_MS,
  approxKey,
  approxPages,
  cardScale,
  contentsLayout,
  previewDelay,
  numberText,
  previewLines,
  typstKey,
  type PreviewLine,
} from "../tocPreview";
import type { TocRow } from "../tocView";

const row = (
  key: string,
  title: string,
  level: number,
  text: string | null,
  extra: Partial<TocItem> = {},
  estimated = false,
): TocRow => ({
  item: {
    key,
    kind: level === 0 ? "page" : "heading",
    level,
    title,
    renamed: false,
    hidden: false,
    ...extra,
  } as TocItem,
  text,
  estimated,
});

describe("previewLines", () => {
  const rows = [
    row("a", "Preface", 0, "iii"),
    row("b", "Arrival", 0, "1"),
    row("b#1:x:0", "The harbour", 1, "2"),
    row("c", "Hidden chapter", 0, "9", { hidden: true }),
    row("custom:1", "Part One", 0, "5", { kind: "custom" }),
  ];
  it("lists the visible entries in order (hidden left out, custom kept) with roman and arabic numbers", () => {
    const lines = previewLines(rows, true);
    expect(lines.map((l) => [l.title, l.level, l.number])).toEqual([
      ["Preface", 0, "iii"],
      ["Arrival", 0, "1"],
      ["The harbour", 1, "2"],
      ["Part One", 0, "5"],
    ]);
  });
  it("sets chapters in bold and headings in regular type", () => {
    expect(previewLines(rows, true).map((l) => l.bold)).toEqual([true, true, false, true]);
  });
  it("carries the part indent into the printed lines, apart from the heading level", () => {
    const lines = previewLines(
      [
        row("pt", "Part One", 0, "1"),
        row("ch", "One", 0, "2", { indent: 1 }),
        row("ch#1:x:0", "Scene", 1, "3", { indent: 2 }),
      ],
      true,
    );
    expect(lines.map((l) => [l.title, l.level, l.indent])).toEqual([
      ["Part One", 0, 0],
      ["One", 0, 1],
      ["Scene", 1, 2],
    ]);
  });
  it("has no numbers when the page numbers are off", () => {
    expect(previewLines(rows, false).every((l) => l.number === null)).toBe(true);
  });
  it("marks an estimate with ≈ and an unknown page with a dash", () => {
    const lines = previewLines([row("a", "A", 0, "4", {}, true), row("b", "B", 0, null)], true);
    expect(lines.map((l) => l.number)).toEqual(["≈4", "–"]);
    expect(numberText({ text: "4", estimated: false })).toBe("4");
  });
  it("says where each entry goes: its page, and for a heading (or a custom entry pointing at one) its position", () => {
    const lines = previewLines(
      [
        row("a", "Arrival", 0, "1", { entryId: "a" }),
        row("a#1:x:0", "The harbour", 1, "2", { entryId: "a", index: 3 }),
        row("custom:1", "See harbour", 1, "2", { kind: "custom", entryId: "a", targetIndex: 3 }),
        row("custom:2", "Elsewhere", 0, "5", { kind: "custom" }),
      ],
      true,
    );
    expect(lines.map((l) => [l.entryId, l.heading])).toEqual([
      ["a", undefined],
      ["a", 3],
      ["a", 3],
      [undefined, undefined],
    ]);
  });
  it("falls back to the entry id for a blank title, as the exports do", () => {
    const [line] = previewLines([row("a", "  ", 0, "1", { entryId: "ch-1" })], false);
    expect(line!.title).toBe("ch-1");
  });
});

describe("contentsLayout", () => {
  it("is the trim size in px at 96 per inch, with more entries on a later page than under the heading", () => {
    const l = contentsLayout({ template: "novel", trimSize: "5x8" });
    expect(l.page).toEqual({ w: 480, h: 768 });
    expect(l.first).toBeGreaterThan(5);
    expect(l.rest).toBeGreaterThan(l.first);
    expect(l.entryPx).toBeGreaterThan(l.fontPx);
  });
  it("falls back to the default template for an unknown one, and a bigger page holds more", () => {
    const small = contentsLayout({ template: "gone", trimSize: "5x8" });
    expect(small.first).toBeGreaterThan(0);
    expect(contentsLayout({ template: "novel", trimSize: "8.5x11" }).rest).toBeGreaterThan(
      small.rest,
    );
  });
  it("always has room for one entry", () => {
    expect(
      contentsLayout({ template: "novel", trimSize: "4.25x6.87" }).first,
    ).toBeGreaterThanOrEqual(1);
  });
});

describe("approxPages", () => {
  const lines = (n: number): PreviewLine[] =>
    Array.from({ length: n }, (_, i) => ({
      key: `k${i}`,
      title: `T${i}`,
      level: 0,
      bold: true,
      number: String(i),
    }));
  const layout = { first: 3, rest: 5 };
  it("is one card, with no folio, for a short list and for an empty one", () => {
    expect(approxPages(lines(3), layout)).toEqual([{ index: 0, lines: lines(3), folio: null }]);
    expect(approxPages([], layout)).toEqual([{ index: 0, lines: [], folio: null }]);
  });
  it("continues on further cards of `rest` lines with a roman folio after the front matter before it", () => {
    const pages = approxPages(lines(14), layout, 2);
    expect(pages.map((p) => p.lines.length)).toEqual([3, 5, 5, 1]);
    expect(pages.map((p) => p.folio)).toEqual([null, "iv", "v", "vi"]);
    expect(pages[1]!.lines[0]!.key).toBe("k3");
  });
  it("starts the folios at ii when the contents page is the first front-matter page", () => {
    expect(approxPages(lines(4), layout).map((p) => p.folio)).toEqual([null, "ii"]);
  });
});

describe("cardScale", () => {
  it("fits the page to the pane minus the padding", () => {
    expect(cardScale(512, 480)).toBeCloseTo((512 - 32) / 480);
    expect(cardScale(400, 480)).toBeCloseTo((400 - 32) / 480);
  });
  it("draws at 1 before the pane is measured, and clamps a very wide or very narrow one", () => {
    expect(cardScale(0, 480)).toBe(1);
    expect(cardScale(500, 0)).toBe(1);
    expect(cardScale(5000, 480)).toBe(1.25);
    expect(cardScale(40, 480)).toBe(0.25);
  });
});

describe("keys and delays", () => {
  const base = {
    title: "Contents",
    lines: [{ key: "a", title: "A", level: 0, bold: true, number: "1" }],
    layout: contentsLayout({ template: "novel", trimSize: "5x8" }),
    before: 0,
    rtl: false,
  };
  it("gives the same key to the same preview and another to any change", () => {
    expect(approxKey(base)).toBe(approxKey({ ...base, lines: [...base.lines] }));
    expect(approxKey(base)).not.toBe(approxKey({ ...base, rtl: true }));
    expect(approxKey(base)).not.toBe(
      approxKey({ ...base, lines: [{ ...base.lines[0]!, number: "≈1" }] }),
    );
    expect(approxKey(base)).not.toBe(approxKey({ ...base, title: "Inhalt" }));
    expect(typstKey(["a", 1])).toBe(typstKey(["a", 1]));
    expect(typstKey(["a", 1])).not.toBe(typstKey(["a", 2]));
    expect(typstKey(["a"])).not.toBe(approxKey(base));
  });
  it("makes the first preview at once and waits longer for Typst than for the estimate", () => {
    expect(previewDelay({ first: true, typst: true })).toBe(0);
    expect(previewDelay({ first: false, typst: true })).toBe(TOC_TYPST_DELAY_MS);
    expect(previewDelay({ first: false, typst: false })).toBe(TOC_APPROX_DELAY_MS);
    expect(TOC_APPROX_DELAY_MS).toBeLessThan(TOC_TYPST_DELAY_MS);
  });
});
