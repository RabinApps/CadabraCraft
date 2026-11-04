import { describe, expect, it } from "vitest";
import {
  CONTENTS_MAX_LEVEL,
  contentsLines,
  contentsTitle,
  nestContents,
  UNTITLED,
} from "../contents";

const item = (level: number, title: string, extra = {}) => ({ level, title, ...extra });

describe("contentsTitle", () => {
  it("keeps a title, else falls back to the entry id, then a placeholder", () => {
    expect(contentsTitle(item(0, "Storm"))).toBe("Storm");
    expect(contentsTitle(item(0, "  ", { entryId: " ch-1 " }))).toBe("ch-1");
    expect(contentsTitle(item(0, ""))).toBe(UNTITLED);
    expect(contentsTitle(item(0, " ", { entryId: " " }))).toBe(UNTITLED);
  });
});

describe("contentsLines", () => {
  const items = [
    item(0, "One"),
    item(1, "Hidden", { hidden: true }),
    item(1, "Two", { hidden: false }),
    item(0, ""),
  ];
  it("drops hidden items and sets bold on chapters only", () => {
    const lines = contentsLines(items);
    expect(lines.map((l) => [l.title, l.level, l.bold, l.number])).toEqual([
      ["One", 0, true, null],
      ["Two", 1, false, null],
      [UNTITLED, 0, true, null],
    ]);
    expect(lines[0]!.item).toBe(items[0]);
  });
  it("asks the caller for each number", () => {
    const lines = contentsLines(items, (i) => (i.level === 0 ? `p${i.title}` : null));
    expect(lines.map((l) => l.number)).toEqual(["pOne", null, "p"]);
  });
  it("has a deepest level", () => expect(CONTENTS_MAX_LEVEL).toBe(3));
});

describe("nestContents", () => {
  it("nests by level and pops back to the nearest lower one", () => {
    const a = item(0, "a");
    const a1 = item(1, "a1");
    const a11 = item(2, "a11");
    const a2 = item(1, "a2");
    const b = item(0, "b");
    const tree = nestContents([a, a1, a11, a2, b]);
    expect(tree.map((n) => n.item)).toEqual([a, b]);
    expect(tree[0]!.kids.map((n) => n.item)).toEqual([a1, a2]);
    expect(tree[0]!.kids[0]!.kids.map((n) => n.item)).toEqual([a11]);
  });
  it("starts a list at any level and is empty for nothing", () => {
    expect(nestContents([item(2, "x"), item(1, "y")]).map((n) => n.item.title)).toEqual(["x", "y"]);
    expect(nestContents([])).toEqual([]);
  });
});
