import { describe, expect, it } from "vitest";
import { wordAtPoint, type TextRun } from "../pdfWords";

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
});
