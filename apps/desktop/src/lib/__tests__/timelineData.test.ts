import { describe, expect, it } from "vitest";
import { buildBoard } from "../scenes/boardData";
import {
  buildTimeline,
  formatStoryDay,
  formatStoryTime,
  joinStoryDate,
  storyDay,
  storyTime,
} from "../scenes/timelineData";
import type { SceneRow } from "../scenes/scenes";

const row = (id: string, date = ""): SceneRow => ({
  id,
  title: id.toUpperCase(),
  status: "",
  pov: "",
  label: "",
  synopsis: "",
  target: null,
  date,
  cast: [],
  words: 0,
});
const book = (...chapters: SceneRow[][]) =>
  buildBoard(
    chapters.map((_, i) => ({ id: `c${i}` })),
    new Map(chapters.map((_, i) => [`c${i}`, `Chapter ${i}`])),
    Object.fromEntries(chapters.map((rows, i) => [`c${i}`, { rows, unsorted: 0 }])),
  );
const ids = (items: { scene: SceneRow }[]) => items.map((i) => i.scene.id);

describe("buildTimeline", () => {
  const b = book(
    [row("a", "1893-09-03"), row("b"), row("c", "1893-09-02")],
    [row("d", "1893-09-04T06:30")],
  );

  it("keeps book order and records each scene's chapter and place", () => {
    const items = buildTimeline(b, "book");
    expect(ids(items)).toEqual(["a", "b", "c", "d"]);
    expect(items.map((i) => [i.chapterTitle, i.bookIndex, i.dated, i.follows])).toEqual([
      ["Chapter 0", 0, true, null],
      ["Chapter 0", 1, false, null],
      ["Chapter 0", 2, true, null],
      ["Chapter 1", 3, true, null],
    ]);
  });

  it("orders dated scenes by date and keeps an undated scene behind the one before it", () => {
    const items = buildTimeline(b, "story");
    expect(ids(items)).toEqual(["c", "a", "b", "d"]);
    expect(items.find((i) => i.scene.id === "b")?.follows).toBe("A");
  });

  it("keeps undated scenes at the start of the book ahead of dated ones and sorts a day before the same day with a time", () => {
    const items = buildTimeline(
      book([row("x"), row("y", "1900-01-01T09:00"), row("z", "1900-01-01"), row("w")]),
      "story",
    );
    expect(ids(items)).toEqual(["x", "z", "w", "y"]);
    expect(items[0]!.follows).toBeNull();
  });

  it("keeps book order for equal dates and an empty book is empty", () => {
    expect(
      ids(buildTimeline(book([row("p", "2000-02-29"), row("q", "2000-02-29")]), "story")),
    ).toEqual(["p", "q"]);
    expect(buildTimeline(book(), "story")).toEqual([]);
  });
});

describe("story date parts", () => {
  it("splits and joins a date and a time", () => {
    expect(storyDay("1893-09-03T18:40")).toBe("1893-09-03");
    expect(storyTime("1893-09-03T18:40")).toBe("18:40");
    expect(storyDay("1893-09-03")).toBe("1893-09-03");
    expect(storyTime("1893-09-03")).toBe("");
    expect(storyDay("")).toBe("");
    expect(storyDay("soon")).toBe("");
    expect(joinStoryDate("1893-09-03", "18:40")).toBe("1893-09-03T18:40");
    expect(joinStoryDate("1893-09-03", "")).toBe("1893-09-03");
    expect(joinStoryDate("", "18:40")).toBe("");
  });

  it("writes the day and the time for a language without moving the day by time zone", () => {
    expect(formatStoryDay("1893-09-03", "en-US")).toBe("Sep 3, 1893");
    expect(formatStoryDay("0099-01-02", "en-US")).toContain("99");
    expect(formatStoryDay("not a date")).toBe("not a date");
    expect(formatStoryTime("1893-09-03T18:40", "en-US")).toMatch(/6:40\sPM/);
    expect(formatStoryTime("1893-09-03", "en-US")).toBe("");
    expect(formatStoryTime("nope")).toBe("");
  });
});
