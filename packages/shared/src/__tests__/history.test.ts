import { describe, expect, it } from "vitest";
import {
  HEATMAP_WEEKS,
  dayTotals,
  emptyWritingFile,
  heatLevel,
  heatmapGrid,
  parseWritingFile,
  recordSave,
  serializeWritingFile,
  shiftDateKey,
  streakEnding,
  summarizeWriting,
  writingRecords,
  type WritingFile,
} from "../index";

// 2026-11-09 is a Monday; its week starts on Sunday 2026-11-08.
const TODAY = "2026-11-09";

describe("dayTotals", () => {
  it("skips records that are not real dates and adds up two records for one day", () => {
    const totals = dayTotals([
      { date: "2026-11-09", words: 100 },
      { date: "2026-11-09", words: 50 },
      { date: "2026-02-30", words: 999 },
      { date: "11/09/2026", words: 999 },
    ]);
    expect([...totals]).toEqual([["2026-11-09", 150]]);
  });
});

describe("streakEnding", () => {
  it("counts back from today when today has words", () => {
    const totals = new Map([
      [TODAY, 10],
      ["2026-11-08", 1],
      ["2026-11-07", 1],
      ["2026-11-05", 1],
    ]);
    expect(streakEnding(totals, TODAY)).toBe(3);
  });

  it("counts back from yesterday when today has no words", () => {
    const totals = new Map([
      ["2026-11-08", 5],
      ["2026-11-07", 5],
    ]);
    expect(streakEnding(totals, TODAY)).toBe(2);
  });

  it("is 0 when neither today nor yesterday has words, and a day with a net loss breaks it", () => {
    expect(streakEnding(new Map([["2026-11-07", 5]]), TODAY)).toBe(0);
    expect(
      streakEnding(
        new Map([
          [TODAY, 0],
          ["2026-11-08", -4],
        ]),
        TODAY,
      ),
    ).toBe(0);
  });
});

describe("summarizeWriting", () => {
  it("gives today, the last seven days (today included), this month and the streak", () => {
    const records = [
      { date: TODAY, words: 612 },
      { date: "2026-11-08", words: 300 },
      { date: "2026-11-03", words: 200 }, // six days before today: in the week
      { date: "2026-11-02", words: 700 }, // seven days before: not in the week, still in the month
      { date: "2026-10-31", words: 5000 }, // last month: in neither
    ];
    expect(summarizeWriting(records, TODAY)).toEqual({
      today: 612,
      last7Days: 1112,
      thisMonth: 1812,
      streak: 2,
    });
  });

  it("does not count days after today", () => {
    const summary = summarizeWriting(
      [
        { date: TODAY, words: 10 },
        { date: "2026-11-12", words: 999 },
      ],
      TODAY,
    );
    expect(summary).toEqual({ today: 10, last7Days: 10, thisMonth: 10, streak: 1 });
  });

  it("is all zero with no records", () => {
    expect(summarizeWriting([], TODAY)).toEqual({
      today: 0,
      last7Days: 0,
      thisMonth: 0,
      streak: 0,
    });
  });
});

describe("heatLevel", () => {
  it("maps no words, a net loss and each band of the fixed scale", () => {
    expect([0, -40, 1, 250, 251, 500, 501, 1000, 1001, 50000].map(heatLevel)).toEqual([
      0, 0, 1, 1, 2, 2, 3, 3, 4, 4,
    ]);
  });
});

describe("heatmapGrid", () => {
  it("has 24 week columns of 7 days, the last week holding today", () => {
    const grid = heatmapGrid([], TODAY);
    expect(grid).toHaveLength(HEATMAP_WEEKS);
    expect(grid.every((week) => week.length === 7)).toBe(true);
    expect(grid[HEATMAP_WEEKS - 1]![0]!.date).toBe("2026-11-08");
    expect(grid[HEATMAP_WEEKS - 1]![1]!.date).toBe(TODAY);
    expect(grid[0]![0]!.date).toBe(shiftDateKey("2026-11-08", -7 * (HEATMAP_WEEKS - 1)));
  });

  it("flags the days after today as future and gives them no words", () => {
    const grid = heatmapGrid([{ date: "2026-11-12", words: 900 }], TODAY);
    const last = grid[HEATMAP_WEEKS - 1]!;
    expect(last.map((c) => c.future)).toEqual([false, false, true, true, true, true, true]);
    expect(last[4]).toEqual({ date: "2026-11-12", words: 0, level: 0, future: true });
  });

  it("fills each day with its words and intensity", () => {
    const grid = heatmapGrid(
      [
        { date: TODAY, words: 612 },
        { date: "2026-11-02", words: 200 },
      ],
      TODAY,
    );
    expect(grid[HEATMAP_WEEKS - 1]![1]).toEqual({
      date: TODAY,
      words: 612,
      level: 3,
      future: false,
    });
    // 2026-11-02 is a Monday, in the week before the last.
    expect(grid[HEATMAP_WEEKS - 2]![1]).toEqual({
      date: "2026-11-02",
      words: 200,
      level: 1,
      future: false,
    });
    expect(grid[HEATMAP_WEEKS - 1]![2]!.words).toBe(0);
  });
});

describe("stats file", () => {
  const sample: WritingFile = {
    version: 1,
    days: { "2026-11-09": 612, "2026-11-08": 300 },
    lastTotal: 40000,
  };

  it("round-trips through its text", () => {
    expect(parseWritingFile(serializeWritingFile(sample))).toEqual(sample);
  });

  it("writes the days in date order and ends with a newline", () => {
    const text = serializeWritingFile({
      version: 1,
      days: { "2026-11-09": 1, "2026-11-01": 2 },
      lastTotal: null,
    });
    expect(text.endsWith("\n")).toBe(true);
    expect(text.indexOf("2026-11-01")).toBeLessThan(text.indexOf("2026-11-09"));
  });

  it("reads a missing lastTotal as null", () => {
    expect(parseWritingFile('{"version":1,"days":{}}')).toEqual({
      version: 1,
      days: {},
      lastTotal: null,
    });
  });

  it("rejects text that is not a stats file", () => {
    const bad = [
      "not json",
      "null",
      "[]",
      '"text"',
      '{"version":2,"days":{}}',
      '{"version":1}',
      '{"version":1,"days":[]}',
      '{"version":1,"days":{"2026-02-30":1}}',
      '{"version":1,"days":{"yesterday":1}}',
      '{"version":1,"days":{"2026-11-09":1.5}}',
      '{"version":1,"days":{"2026-11-09":"12"}}',
      '{"version":1,"days":{},"lastTotal":-1}',
      '{"version":1,"days":{},"lastTotal":2.5}',
      '{"version":1,"days":{},"lastTotal":"5"}',
    ];
    for (const text of bad) expect(parseWritingFile(text), text).toBeNull();
  });

  it("starts empty", () => {
    expect(emptyWritingFile()).toEqual({ version: 1, days: {}, lastTotal: null });
  });

  it("turns the days into records", () => {
    expect(writingRecords(sample)).toEqual([
      { date: "2026-11-09", words: 612 },
      { date: "2026-11-08", words: 300 },
    ]);
  });
});

describe("recordSave", () => {
  it("only sets the baseline on the first save, so the book's existing words are not today's", () => {
    const next = recordSave(emptyWritingFile(), 40000, TODAY);
    expect(next).toEqual({ version: 1, days: {}, lastTotal: 40000 });
  });

  it("adds the difference from the last saved total to today", () => {
    const file: WritingFile = { version: 1, days: { [TODAY]: 100 }, lastTotal: 1000 };
    expect(recordSave(file, 1250, TODAY)).toEqual({
      version: 1,
      days: { [TODAY]: 350 },
      lastTotal: 1250,
    });
  });

  it("starts a day with the difference and records a net loss as a negative", () => {
    const file: WritingFile = { version: 1, days: {}, lastTotal: 1000 };
    expect(recordSave(file, 1200, TODAY).days).toEqual({ [TODAY]: 200 });
    expect(recordSave(file, 900, TODAY).days).toEqual({ [TODAY]: -100 });
  });

  it("returns the same file when the total did not change", () => {
    const file: WritingFile = { version: 1, days: { [TODAY]: 5 }, lastTotal: 1000 };
    expect(recordSave(file, 1000, TODAY)).toBe(file);
  });
});
