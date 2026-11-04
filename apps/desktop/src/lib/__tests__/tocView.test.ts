import { addTocCustom, DEFAULT_TOC, type EditionEntry, type TocItem } from "@cadabracraft/format";
import type { PageReport } from "@cadabracraft/export-pdf";
import { describe, expect, it } from "vitest";
import {
  headingPageNumbers,
  needsOutlines,
  printedNumber,
  staleKeys,
  staleLabel,
  tocRows,
  type TocNumber,
} from "../tocView";

/** A layout number: `estimated` unless it is a measured count. */
const n = (text: string | null, estimated = false): TocNumber => ({ text, estimated });

const page = (key: string, title = key): TocItem => ({
  key,
  kind: "page",
  entryId: key,
  level: 0,
  title,
  renamed: false,
  hidden: false,
});
const outline = (...levels: [number, string][]) =>
  levels.map(([level, text], index) => ({ index, level, text }));
const report = (
  starts: PageReport["starts"],
  marks?: Record<string, { kind: "h" | "p"; page: number }[]>,
): PageReport => ({
  total: 50,
  starts,
  ...(marks
    ? {
        blocks: Object.fromEntries(
          Object.entries(marks).map(([id, list]) => [
            id,
            list.map((m, block) => ({ block, leaf: 0, kind: m.kind, page: m.page, splits: [] })),
          ]),
        ),
      }
    : {}),
});
const start = (id: string, pageNo: number, number: string): PageReport["starts"][number] => ({
  id,
  kind: "chapter",
  page: pageNo,
  end: pageNo + 3,
  number,
});

describe("printedNumber", () => {
  it("counts on from an arabic start", () => {
    expect(printedNumber({ page: 5, number: "1" }, 5)).toBe("1");
    expect(printedNumber({ page: 5, number: "9" }, 7)).toBe("11");
  });
  it("counts on in roman numerals", () => {
    expect(printedNumber({ page: 3, number: "iii" }, 5)).toBe("v");
    expect(printedNumber({ page: 3, number: "viii" }, 5)).toBe("x");
    expect(printedNumber({ page: 3, number: "xxxix" }, 4)).toBe("xl");
  });
  it("gives up on a page before the start, no number or text that is not a number", () => {
    expect(printedNumber({ page: 5, number: "1" }, 4)).toBeNull();
    expect(printedNumber({ page: 5, number: "" }, 5)).toBeNull();
    expect(printedNumber({ page: 5, number: "abc" }, 5)).toBeNull();
    expect(printedNumber({ page: 5, number: "iiv" }, 5)).toBeNull(); // not a canonical numeral
  });
});

describe("headingPageNumbers", () => {
  const outlines = { c1: outline([1, "A"], [2, "B"], [2, "B"]), c2: outline([1, "Z"]) };
  it("maps a chapter's h marks onto its headings, in order, by their keys", () => {
    const r = report([start("c1", 5, "1"), start("c2", 10, "6")], {
      c1: [
        { kind: "h", page: 5 },
        { kind: "p", page: 5 },
        { kind: "h", page: 6 },
        { kind: "h", page: 7 },
      ],
      c2: [{ kind: "h", page: 10 }],
    });
    expect(headingPageNumbers(r, outlines)).toEqual({
      "c1#1:a:0": "1",
      "c1#2:b:0": "2",
      "c1#2:b:1": "3",
      "c2#1:z:0": "6",
    });
  });
  it("skips a chapter whose marks do not fit its headings, and one the report does not know", () => {
    const r = report([start("c1", 5, "1")], { c1: [{ kind: "h", page: 5 }] });
    expect(headingPageNumbers(r, outlines)).toEqual({});
    expect(headingPageNumbers(report([start("c1", 5, "1")]), outlines)).toEqual({});
  });
  it("counts empty headings: the outline leaves them out, the marks do not", () => {
    // Headings "A", "" and "B" of one chapter: the outline has indexes 0 and 2, the report three h marks.
    const gap = {
      c1: [
        { index: 0, level: 1, text: "A" },
        { index: 2, level: 1, text: "B" },
      ],
    };
    const r = report([start("c1", 5, "1")], {
      c1: [
        { kind: "h", page: 5 },
        { kind: "h", page: 5 },
        { kind: "h", page: 7 },
      ],
    });
    expect(headingPageNumbers(r, gap)).toEqual({ "c1#1:a:0": "1", "c1#1:b:0": "3" });
    // Fewer marks than the last heading's position: the text moved since the measure.
    const short = report([start("c1", 5, "1")], {
      c1: [
        { kind: "h", page: 5 },
        { kind: "h", page: 5 },
      ],
    });
    expect(headingPageNumbers(short, gap)).toEqual({});
    expect(headingPageNumbers(r, { c1: [] })).toEqual({});
  });
  it("skips a heading whose page number cannot be told", () => {
    const r = report([start("c2", 10, "x1")], { c2: [{ kind: "h", page: 10 }] });
    expect(headingPageNumbers(r, outlines)).toEqual({});
  });
});

describe("tocRows page-number precedence", () => {
  const items = [page("c1"), page("c2"), page("c3")];
  const heading: TocItem = {
    key: "c1#1:a:0",
    kind: "heading",
    entryId: "c1",
    level: 1,
    title: "A",
    renamed: false,
    hidden: false,
    index: 0,
  };
  const custom: TocItem = {
    key: "custom:c-1",
    kind: "custom",
    level: 0,
    title: "X",
    renamed: false,
    hidden: false,
    target: "c2",
  };
  it("uses Typst's numbers when the report is current", () => {
    const rows = tocRows(items, {
      report: report([start("c1", 1, "1"), start("c2", 9, "9")]),
      current: true,
      numbers: { c1: n("1"), c2: n("4"), c3: n("5", true) },
      outlines: {},
    });
    expect(rows.map((r) => [r.text, r.estimated])).toEqual([
      ["1", false],
      ["9", false],
      ["5", true], // not in the report: the estimate
    ]);
  });
  it("marks the numbers of a report the book has moved on from as estimates", () => {
    const rows = tocRows(items, {
      report: report([start("c1", 1, "1")]),
      current: false,
      numbers: {},
      outlines: {},
    });
    expect(rows[0]).toMatchObject({ text: "1", estimated: true });
    expect(rows[1]).toMatchObject({ text: null, estimated: false });
  });
  it("falls back to the layout's numbers without a report, and to nothing without either", () => {
    const rows = tocRows(items, {
      report: null,
      current: false,
      numbers: { c1: n("i", true), c2: n("7", true) },
      outlines: {},
    });
    expect(rows.map((r) => [r.text, r.estimated])).toEqual([
      ["i", true],
      ["7", true],
      [null, false],
    ]);
  });
  it("shows a custom entry's target number and heading numbers from the marks", () => {
    const r = report([start("c1", 1, "1"), start("c2", 9, "9")], {
      c1: [{ kind: "h", page: 2 }],
    });
    const rows = tocRows([items[0]!, heading, custom], {
      report: r,
      current: true,
      numbers: {},
      outlines: { c1: outline([1, "A"]) },
    });
    expect(rows.map((x) => x.text)).toEqual(["1", "2", "9"]);
    const guessed = tocRows([custom], {
      report: null,
      current: false,
      numbers: { c2: n("4", true) },
      outlines: {},
    });
    expect(guessed[0]).toMatchObject({ text: "4", estimated: true });
  });
  it("leaves a page whose page prints no number without one, and a pointer to nothing", () => {
    const rows = tocRows([page("c1"), { ...custom, target: undefined } as TocItem], {
      report: report([start("c1", 1, "")]),
      current: true,
      numbers: {},
      outlines: {},
    });
    expect(rows.map((x) => x.text)).toEqual([null, null]);
  });
});

describe("stale overrides", () => {
  const entry = (toc: Partial<EditionEntry["toc"] & object>): EditionEntry => ({
    id: "toc",
    kind: "contents",
    titles: { en: "Contents" },
    files: {},
    toc: { ...DEFAULT_TOC, ...toc },
  });
  it("labels a stale key by the author's text, a custom entry's title or the heading text in its key", () => {
    const e = entry({
      titles: { "c1#2:the harbour:0": { en: "Harbour" }, gone: { fr: "Disparu" } },
      custom: [{ id: "c-1", titles: { fr: "Postface" }, after: "x" }],
    });
    expect(staleLabel(e, "c1#2:the harbour:0", "en")).toBe("Harbour");
    expect(staleLabel(e, "gone", "en")).toBe("Disparu"); // another language's text still names it
    expect(staleLabel(e, "custom:c-1", "en")).toBe("Postface");
    expect(staleLabel(e, "c1#2:the inn:1", "en")).toBe("the inn");
    expect(staleLabel(e, "chapter-9", "en")).toBe("chapter-9");
  });
  it("groups stale overrides by key and leaves custom entries to the list", () => {
    expect(
      staleKeys([
        { kind: "hidden", key: "a" },
        { kind: "title", key: "a" },
        { kind: "order", key: "b" },
        { kind: "custom", key: "custom:c-1", field: "after" },
      ]),
    ).toEqual(["a", "b"]);
  });
  it("needs the headings only when the list or an override mentions one", () => {
    expect(needsOutlines(DEFAULT_TOC)).toBe(false);
    expect(needsOutlines({ ...DEFAULT_TOC, depth: 1 })).toBe(true);
    expect(needsOutlines({ ...DEFAULT_TOC, hidden: ["a#1:b:0"] })).toBe(true);
    expect(needsOutlines({ ...DEFAULT_TOC, titles: { "a#1:b:0": { en: "x" } } })).toBe(true);
    expect(needsOutlines({ ...DEFAULT_TOC, order: ["a", "a#1:b:0"] })).toBe(true);
    expect(
      needsOutlines({
        ...DEFAULT_TOC,
        custom: [{ id: "c-1", titles: { en: "x" }, after: "a#1:b:0" }],
      }),
    ).toBe(true);
    expect(
      needsOutlines({
        ...DEFAULT_TOC,
        custom: [{ id: "c-1", titles: { en: "x" }, after: "a", target: "b#1:c:0" }],
      }),
    ).toBe(true);
    expect(
      needsOutlines({
        ...DEFAULT_TOC,
        hidden: ["a"],
        order: ["a"],
        custom: [{ id: "c-1", titles: { en: "x" }, after: "a", target: "b" }],
      }),
    ).toBe(false);
    expect(addTocCustom).toBeDefined();
  });
});
