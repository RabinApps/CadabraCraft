import { describe, expect, it } from "vitest";
import { wordAtPoint, type TextRun } from "../export/pdfWords";

const run = (
  str: string,
  e: number,
  f: number,
  width: number,
  extra: Partial<TextRun> = {},
): TextRun => ({
  str,
  transform: [10, 0, 0, 10, e, f],
  width,
  height: 10,
  ...extra,
});

describe("wordAtPoint", () => {
  // Two lines of ten characters each, 100 pt wide (10 pt a character), the second line 14 pt below the first.
  const runs = [run("alpha beta", 50, 700, 100), run("gamma  del", 50, 686, 100)];

  it("is the word under the point, counted among all the words of the page", () => {
    expect(wordAtPoint(runs, 55, 703)).toEqual({
      tokens: ["alpha", "beta", "gamma", "del"],
      index: 0,
    });
    expect(wordAtPoint(runs, 120, 703)?.index).toBe(1);
    expect(wordAtPoint(runs, 60, 689)?.index).toBe(2);
    expect(wordAtPoint(runs, 148, 689)?.index).toBe(3);
  });

  it("takes the word after a space for a point on the space", () => {
    // Character 5 of "alpha beta" is the space.
    expect(wordAtPoint(runs, 50 + 5 * 10 + 2, 702)?.index).toBe(1);
  });

  it("is null for a point on no line of text or a line with no word under it", () => {
    expect(wordAtPoint(runs, 10, 703)).toBeNull();
    expect(wordAtPoint(runs, 55, 600)).toBeNull();
    expect(wordAtPoint(runs, 200, 703)).toBeNull();
    // On the trailing space of a run there is no word after it.
    expect(wordAtPoint([run("one ", 0, 0, 40)], 38, 2)).toBeNull();
  });

  it("does not look at text drawn sideways, empty runs or runs with no width, and uses the first run that is hit", () => {
    expect(
      wordAtPoint([run("up", 50, 700, 20, { transform: [0, 10, -10, 0, 50, 700] })], 55, 703),
    ).toBeNull();
    expect(wordAtPoint([run("", 50, 700, 20)], 55, 703)).toBeNull();
    expect(wordAtPoint([run("zero", 50, 700, 0)], 50, 700)).toBeNull();
    expect(wordAtPoint([run("a b", 0, 0, 30), run("a b", 0, 0, 30)], 25, 3)).toEqual({
      tokens: ["a", "b", "a", "b"],
      index: 1,
    });
  });

  it("copes with runs that have no height or a missing transform", () => {
    expect(wordAtPoint([run("ab", 0, 0, 20, { height: 0 })], 5, 5)?.index).toBe(0);
    expect(wordAtPoint([{ str: "ab", transform: [], width: 20, height: 0 }], 5, 5)?.index).toBe(0);
  });

  it("does not take the room under a large run (a drop cap) for part of the line it stands on", () => {
    const cap = run("T", 50, 700, 30, { transform: [60, 0, 0, 60, 50, 700], height: 60 });
    // 10 pt below the drop cap's baseline is where the third line beside it is, not the drop cap; 2 pt below is still its descender.
    expect(wordAtPoint([cap], 60, 690)).toBeNull();
    expect(wordAtPoint([cap], 60, 698)?.index).toBe(0);
  });
});

describe("wordAtPoint on a right-to-left page", () => {
  // As pdf.js gives a Hebrew page: a run for each word, the runs of a line left to right as drawn, the text of each in reading order, the
  // lines top to bottom. Line one reads (right to left) "one two three"; line two "four 1984 five" with the number drawn between.
  const rtl = (str: string, e: number, f: number, width: number): TextRun =>
    run(str, e, f, width, { dir: "rtl" });
  const runs: TextRun[] = [
    rtl("three", 20, 700, 30),
    rtl(" ", 50, 700, 3),
    rtl("two", 53, 700, 20),
    rtl(" ", 73, 700, 3),
    rtl("one", 76, 700, 24),
    rtl("five", 30, 686, 28),
    run("1984", 70, 686, 30, { dir: "ltr" }),
    rtl("four", 110, 686, 26),
  ];

  it("counts the words of a line from its right edge, a left-to-right run staying whole in its place", () => {
    expect(wordAtPoint(runs, 90, 702)).toEqual({
      tokens: ["one", "two", "three", "four", "1984", "five"],
      index: 0,
    });
    expect(wordAtPoint(runs, 60, 702)?.index).toBe(1);
    expect(wordAtPoint(runs, 25, 702)?.index).toBe(2);
    expect(wordAtPoint(runs, 120, 688)?.index).toBe(3);
    expect(wordAtPoint(runs, 80, 688)?.index).toBe(4);
    expect(wordAtPoint(runs, 40, 688)?.index).toBe(5);
  });

  it("counts the characters of a run from its right edge", () => {
    const line = [rtl("אבג דהו", 0, 700, 70)];
    expect(wordAtPoint(line, 66, 702)?.index).toBe(0);
    expect(wordAtPoint(line, 4, 702)?.index).toBe(1);
  });

  it("copes with right-to-left runs that have no transform", () => {
    const bare = (str: string): TextRun => ({
      str,
      transform: [],
      width: 20,
      height: 0,
      dir: "rtl",
    });
    expect(wordAtPoint([bare("ab"), bare("cd")], 5, 5)?.tokens).toEqual(["ab", "cd"]);
  });

  it("takes a run for right-to-left when its letters are, if pdf.js gave no direction", () => {
    const text = (str: string, e: number): TextRun => ({
      str,
      transform: [10, 0, 0, 10, e, 700],
      width: 30,
      height: 10,
    });
    expect(wordAtPoint([text("שלום", 0), text("עולם", 40)], 70, 702)).toEqual({
      tokens: ["עולם", "שלום"],
      index: 0,
    });
    expect(wordAtPoint([text("one", 0), text("two", 40)], 5, 702)?.tokens).toEqual(["one", "two"]);
  });
});
