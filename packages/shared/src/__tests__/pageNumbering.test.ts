import { describe, expect, it } from "vitest";
import { folioAt, folioText, formatFolio, layoutBook, type PageEntryInput } from "../pageNumbering";

const ch = (id: string, pages: number, exact = true): PageEntryInput => ({
  id,
  section: "chapter",
  pages,
  exact,
});
const front = (
  id: string,
  kind: PageEntryInput["kind"],
  pages = 1,
  extra = {},
): PageEntryInput => ({
  id,
  section: "front",
  kind,
  pages,
  exact: true,
  ...extra,
});
const back = (id: string, kind: PageEntryInput["kind"], pages = 1, extra = {}): PageEntryInput => ({
  id,
  section: "back",
  kind,
  pages,
  exact: true,
  ...extra,
});
const startOf = (b: ReturnType<typeof layoutBook>, id: string) => b.byId.get(id)!;

describe("layoutBook: chapters only", () => {
  it("continues the count from chapter to chapter, with a blank left-hand page where the next would be even", () => {
    const b = layoutBook([ch("a", 5), ch("b", 6), ch("c", 5)], { startsOn: "recto" });
    expect(b.entries.map((e) => [e.id, e.start, e.blankBefore, e.number])).toEqual([
      ["a", 1, false, 1],
      ["b", 7, true, 7],
      ["c", 13, false, 13],
    ]);
    expect(b.physical).toBe(17);
    expect(b.bodyPages).toBe(17);
    expect(b.hasFront).toBe(false);
    expect(b.arabicFrom).toBe(1);
  });

  it("starts a chapter on the next page when the template does not care about sides", () => {
    const b = layoutBook([ch("a", 5), ch("b", 6)], { startsOn: "any" });
    expect(startOf(b, "b")).toMatchObject({ start: 6, blankBefore: false, number: 6 });
  });

  it("needs no blank page when the previous chapter ends on a left-hand page", () => {
    const b = layoutBook([ch("a", 4), ch("b", 1)], { startsOn: "recto" });
    expect(startOf(b, "b")).toMatchObject({ start: 5, blankBefore: false });
  });

  it("counts at least one page for an entry, whatever it says", () => {
    const b = layoutBook([ch("a", 0)], { startsOn: "any" });
    expect(startOf(b, "a")).toMatchObject({ pages: 1, end: 1 });
  });

  it("is exact only when every entry is", () => {
    expect(layoutBook([ch("a", 1), ch("b", 1)], { startsOn: "any" }).exact).toBe(true);
    expect(layoutBook([ch("a", 1), ch("b", 1, false)], { startsOn: "any" }).exact).toBe(false);
    expect(layoutBook([], { startsOn: "any" })).toMatchObject({
      exact: false,
      physical: 0,
      bodyPages: 1 - 1,
    });
  });

  it("knows which starts are real: those before an estimate are not, the estimate's own start still is", () => {
    const b = layoutBook([ch("a", 3), ch("b", 4, false), ch("c", 2)], { startsOn: "any" });
    expect(b.entries.map((e) => [e.id, e.start, e.startExact])).toEqual([
      ["a", 1, true],
      ["b", 4, true], // the entries before it are measured
      ["c", 8, false], // the entry before it is an estimate
    ]);
    // A start Typst gave is real whatever the counts around it are.
    const given = layoutBook([{ ...ch("a", 3, false), start: 5 }], { startsOn: "any" });
    expect(startOf(given, "a").startExact).toBe(true);
  });

  it("takes the book's own total over what the entries add up to", () => {
    const b = layoutBook([ch("a", 2)], { startsOn: "any", total: 8 });
    expect(b.physical).toBe(8);
    expect(b.bodyPages).toBe(8);
    // A total shorter than the entries is impossible: the entries win.
    expect(layoutBook([ch("a", 6)], { startsOn: "any", total: 2 }).physical).toBe(6);
    const withFront = layoutBook([front("t", "title-page"), ch("a", 2)], {
      startsOn: "any",
      total: 9,
    });
    expect(withFront.bodyPages).toBe(7);
  });
});

describe("layoutBook: front and back matter", () => {
  const book = () =>
    layoutBook(
      [
        front("t", "title-page"),
        front("c", "copyright"),
        front("toc", "contents"),
        front("d", "dedication"),
        front("f", "foreword"),
        front("p", "preface"),
        ch("one", 8),
        ch("two", 6),
        back("ack", "acknowledgments"),
      ],
      { startsOn: "recto" },
    );

  it("numbers the front matter in roman by physical page and restarts at arabic 1 on a right-hand page", () => {
    const b = book();
    // Same layout as real Typst gives (see the render test in export-pdf).
    expect(b.entries.map((e) => [e.id, e.start, e.style, e.number])).toEqual([
      ["t", 1, "roman", null],
      ["c", 2, "roman", null],
      ["toc", 3, "roman", null],
      ["d", 5, "roman", 5],
      ["f", 7, "roman", 7],
      ["p", 9, "roman", 9],
      ["one", 11, "arabic", 1],
      ["two", 19, "arabic", 9],
      ["ack", 25, "arabic", 15],
    ]);
    expect(b.arabicFrom).toBe(11);
    expect(b.bodyPages).toBe(15);
    expect(b.physical).toBe(25);
  });

  it("marks which entries have a blank left-hand page before them", () => {
    const b = book();
    expect(b.entries.filter((e) => e.blankBefore).map((e) => e.id)).toEqual(["d", "f", "p", "one"]);
  });

  it("opens a centred matter page on the next page, and an uncentred one like a chapter", () => {
    const centred = layoutBook(
      [front("a", "foreword", 1, { centred: true }), front("b", "preface", 1, { centred: true })],
      { startsOn: "recto" },
    );
    expect(centred.entries.map((e) => e.start)).toEqual([1, 2]);
    const plain = layoutBook([front("a", "foreword"), front("b", "preface")], {
      startsOn: "recto",
    });
    expect(plain.entries.map((e) => e.start)).toEqual([1, 3]);
    const any = layoutBook([front("a", "foreword"), front("b", "preface")], { startsOn: "any" });
    expect(any.entries.map((e) => e.start)).toEqual([1, 2]);
  });

  it("lets the author start a page on the next one, so no blank page comes before it", () => {
    const b = layoutBook(
      [
        front("t", "title-page"),
        front("d", "dedication", 1, { startOnNext: true }),
        front("f", "foreword", 1, { centred: true }),
      ],
      { startsOn: "any" },
    );
    expect(b.entries.map((e) => [e.id, e.start, e.blankBefore])).toEqual([
      ["t", 1, false],
      ["d", 2, false],
      ["f", 3, false],
    ]);
    // Without the choice the dedication opens on a right-hand page, with a blank left-hand page before it.
    const plain = layoutBook([front("t", "title-page"), front("d", "dedication")], {
      startsOn: "any",
    });
    expect(plain.entries.map((e) => [e.start, e.blankBefore])).toEqual([
      [1, false],
      [3, true],
    ]);
  });

  it("lets the page after a dedication follow it on the left, or start on a right-hand page as usual", () => {
    const followOn = layoutBook(
      [front("d", "epigraph"), front("f", "foreword", 1, { centred: true, startOnNext: true })],
      { startsOn: "any" },
    );
    expect(followOn.entries.map((e) => [e.start, e.blankBefore])).toEqual([
      [1, false],
      [2, false],
    ]);
    const rules = layoutBook(
      [front("d", "epigraph"), front("f", "foreword", 1, { centred: true })],
      { startsOn: "any" },
    );
    expect(rules.entries.map((e) => [e.start, e.blankBefore])).toEqual([
      [1, false],
      [3, true],
    ]);
  });

  it("still restarts the arabic count on a right-hand page whatever the last front matter page chose", () => {
    const b = layoutBook(
      [front("f", "foreword", 1, { startOnNext: true }), ch("one", 1)],
      { startsOn: "recto" },
    );
    expect(b.entries.map((e) => [e.start, e.style, e.number])).toEqual([
      [1, "roman", 1],
      [3, "arabic", 1],
    ]);
    expect(b.arabicFrom).toBe(3);
  });

  it("opens the page after an epigraph on a right-hand page", () => {
    const b = layoutBook([front("e", "epigraph"), front("f", "foreword", 1, { centred: true })], {
      startsOn: "any",
    });
    expect(b.entries.map((e) => e.start)).toEqual([1, 3]);
  });

  it("is all roman when there is only front matter, and has no arabic pages", () => {
    const b = layoutBook([front("t", "title-page"), front("f", "foreword", 2)], {
      startsOn: "any",
    });
    expect(b.arabicFrom).toBeNull();
    expect(b.bodyPages).toBe(0);
    expect(b.entries.map((e) => e.style)).toEqual(["roman", "roman"]);
  });

  it("numbers back matter alone from 1 after the front matter", () => {
    const b = layoutBook([front("f", "foreword"), back("a", "colophon")], { startsOn: "any" });
    expect(startOf(b, "a")).toMatchObject({ start: 3, style: "arabic", number: 1 });
  });

  it("trusts the start page Typst gave over the rules", () => {
    const b = layoutBook(
      [
        { ...ch("a", 3), start: 1 },
        { ...ch("b", 2), start: 6 },
        { ...ch("c", 2), start: 0 },
      ],
      { startsOn: "recto" },
    );
    expect(b.entries.map((e) => [e.start, e.blankBefore])).toEqual([
      [1, false],
      [6, true],
      [1, false],
    ]);
  });

  it("prints no numbers when the book has none", () => {
    const b = layoutBook([front("f", "foreword"), ch("a", 2)], {
      startsOn: "any",
      numbered: false,
    });
    expect(b.numbered).toBe(false);
    expect(b.entries.map((e) => e.number)).toEqual([null, null]);
    expect(folioText(b, 1)).toBe("");
  });
});

describe("formatFolio, folioAt and folioText", () => {
  it("writes roman and arabic numerals", () => {
    expect(formatFolio(4, "arabic")).toBe("4");
    expect(formatFolio(1994, "roman")).toBe("mcmxciv");
    expect(formatFolio(8, "roman")).toBe("viii");
    expect(formatFolio(0, "roman")).toBe("0");
  });

  it("tells the style and number of any physical page, a blank one included", () => {
    const b = layoutBook([front("t", "title-page"), front("f", "foreword"), ch("a", 2)], {
      startsOn: "recto",
    });
    expect(b.arabicFrom).toBe(5);
    expect(folioAt(b, 4)).toEqual({ style: "roman", number: 4 });
    expect(folioAt(b, 5)).toEqual({ style: "arabic", number: 1 });
    expect(folioAt(b, 6)).toEqual({ style: "arabic", number: 2 });
    expect(folioText(b, 3)).toBe("iii");
    expect(folioText(b, 1)).toBe("");
    expect(folioText(b, 5)).toBe("1");
  });

  it("reads a page that is in no entry (past the end) by the same rule", () => {
    const b = layoutBook([ch("a", 2)], { startsOn: "any" });
    expect(folioText(b, 9)).toBe("9");
  });

  it("is all roman for a book with only front matter", () => {
    const b = layoutBook([front("f", "foreword")], { startsOn: "any" });
    expect(folioAt(b, 1)).toEqual({ style: "roman", number: 1 });
  });
});
