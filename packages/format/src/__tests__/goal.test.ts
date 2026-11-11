import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  CURRENT_FORMAT_VERSION,
  MAX_GOAL_WORDS,
  MIGRATIONS,
  createManifest,
  dailyPlan,
  parseManifest,
  readingOrder,
  serializeManifest,
  validateGoal,
  validateManifest,
  type Manifest,
} from "../index";

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

describe("validateGoal", () => {
  it("accepts a word target alone and a target with a deadline", () => {
    expect(validateGoal({ words: 80000 })).toEqual({ words: 80000 });
    expect(validateGoal({ words: 1, deadline: "2027-06-30" })).toEqual({
      words: 1,
      deadline: "2027-06-30",
    });
    expect(validateGoal({ words: MAX_GOAL_WORDS })).toEqual({ words: MAX_GOAL_WORDS });
  });

  it("refuses anything that is not a plain object", () => {
    for (const bad of [null, [], "80000", 80000, true]) {
      expect(() => validateGoal(bad)).toThrow(/must be an object/);
    }
  });

  it("refuses unknown keys so a typo is never lost", () => {
    expect(() => validateGoal({ words: 10, deadlin: "2027-01-01" })).toThrow(
      /unknown key "goal.deadlin"/,
    );
  });

  it("refuses a missing or invalid word target", () => {
    const message = /goal\.words" must be a whole number/;
    expect(() => validateGoal({})).toThrow(message);
    expect(() => validateGoal({ words: "80000" })).toThrow(message);
    expect(() => validateGoal({ words: 1.5 })).toThrow(message);
    expect(() => validateGoal({ words: Number.NaN })).toThrow(message);
    expect(() => validateGoal({ words: 0 })).toThrow(message);
    expect(() => validateGoal({ words: -5 })).toThrow(message);
    expect(() => validateGoal({ words: MAX_GOAL_WORDS + 1 })).toThrow(message);
  });

  it("refuses a deadline that is not a real YYYY-MM-DD date", () => {
    const message = /goal\.deadline" must be a date as YYYY-MM-DD/;
    expect(() => validateGoal({ words: 10, deadline: "2027-6-30" })).toThrow(message);
    expect(() => validateGoal({ words: 10, deadline: "2027-02-29" })).toThrow(message);
    expect(() => validateGoal({ words: 10, deadline: null })).toThrow(message);
    expect(() => validateGoal({ words: 10, deadline: 20270630 })).toThrow(message);
  });

  it("names the field in the error when a custom name is given", () => {
    expect(() => validateGoal({ words: 0 }, "x")).toThrow(/x\.words/);
  });
});

describe("dailyPlan", () => {
  const today = "2026-11-09";

  it("has no daily figure without a deadline, but still reports what remains", () => {
    expect(dailyPlan({ words: 1000 }, 400, today)).toEqual({
      remaining: 600,
      met: false,
      daysLeft: null,
      wordsPerDay: null,
      late: false,
    });
  });

  it("is met, with nothing to write, once the book reaches the target", () => {
    expect(dailyPlan({ words: 1000 }, 1000, today)).toEqual({
      remaining: 0,
      met: true,
      daysLeft: null,
      wordsPerDay: null,
      late: false,
    });
    expect(dailyPlan({ words: 1000 }, 4000, today).remaining).toBe(0);
  });

  it("divides what remains over the days to the deadline, today included, rounding up", () => {
    // 2026-11-09 to 2026-11-18 is ten days counting both ends.
    expect(dailyPlan({ words: 1000, deadline: "2026-11-18" }, 0, today)).toEqual({
      remaining: 1000,
      met: false,
      daysLeft: 10,
      wordsPerDay: 100,
      late: false,
    });
    // 1000 words over 3 days is 333.33, so 334 a day.
    expect(dailyPlan({ words: 1000, deadline: "2026-11-11" }, 0, today).wordsPerDay).toBe(334);
  });

  it("counts a deadline of today as one day to write", () => {
    expect(dailyPlan({ words: 500, deadline: today }, 200, today)).toEqual({
      remaining: 300,
      met: false,
      daysLeft: 1,
      wordsPerDay: 300,
      late: false,
    });
  });

  it("is met with no daily figure to write when the goal is reached before the deadline", () => {
    expect(dailyPlan({ words: 500, deadline: "2026-12-01" }, 500, today)).toEqual({
      remaining: 0,
      met: true,
      daysLeft: 23,
      wordsPerDay: 0,
      late: false,
    });
  });

  it("is late, with the whole remainder due now, when the deadline has passed unmet", () => {
    expect(dailyPlan({ words: 1000, deadline: "2026-11-01" }, 250, today)).toEqual({
      remaining: 750,
      met: false,
      daysLeft: 0,
      wordsPerDay: 750,
      late: true,
    });
  });

  it("is not late after a deadline that passed once the goal was met", () => {
    expect(dailyPlan({ words: 1000, deadline: "2026-11-01" }, 1000, today)).toEqual({
      remaining: 0,
      met: true,
      daysLeft: 0,
      wordsPerDay: 0,
      late: false,
    });
  });

  it("refuses a word count that is not a whole number zero or more", () => {
    expect(() => dailyPlan({ words: 10 }, -1, today)).toThrow(RangeError);
    expect(() => dailyPlan({ words: 10 }, 1.5, today)).toThrow(RangeError);
    expect(() => dailyPlan({ words: 10 }, Number.NaN, today)).toThrow(RangeError);
  });

  it("refuses a today that is not a real date", () => {
    expect(() => dailyPlan({ words: 10 }, 0, "2026-13-01")).toThrow(/not a calendar date/);
  });

  it("works across a month and a leap day", () => {
    // 2028-02-28 to 2028-03-01 is three days counting both ends (2028 is a leap year).
    expect(dailyPlan({ words: 300, deadline: "2028-03-01" }, 0, "2028-02-28").wordsPerDay).toBe(
      100,
    );
  });
});

describe("the goal in the manifest (formatVersion 13)", () => {
  const base = (): Manifest =>
    createManifest({
      title: "Goal Book",
      author: "A. Writer",
      identifier: "urn:uuid:6f1d2c3a-4b5e-4f70-8a9b-0c1d2e3f4a5b",
    });

  it("is version 15 now, and the migration from 12 changed nothing", () => {
    expect(CURRENT_FORMAT_VERSION).toBe(15);
    const step = MIGRATIONS.find((m) => m.from === 12);
    expect(step).toBeDefined();
    const raw = { formatVersion: 12, editions: [] };
    expect(step!.up(raw)).toEqual(raw);
  });

  it("has no goal when none is set, and writes none", () => {
    const m = base();
    expect(m.goal).toBeUndefined();
    expect(JSON.parse(serializeManifest(m))).not.toHaveProperty("goal");
  });

  it("keeps a goal through a save and a reopen", () => {
    const m = { ...base(), goal: { words: 80000, deadline: "2027-06-30" } };
    const json = serializeManifest(m);
    expect(JSON.parse(json).goal).toEqual({ words: 80000, deadline: "2027-06-30" });
    const again = parseManifest(json);
    expect(again.migrated).toBe(false);
    expect(again.manifest.goal).toEqual({ words: 80000, deadline: "2027-06-30" });
  });

  it("refuses a bad goal inside the manifest", () => {
    expect(() => validateManifest({ ...base(), goal: { words: 0 } })).toThrow(/goal\.words/);
    expect(() => validateManifest({ ...base(), goal: "80000" })).toThrow(/goal" must be an object/);
  });
});

describe("migration v12 -> v13 (a real v12 manifest)", () => {
  const v12Json = read("../../../../fixtures/contract/manifest-v12.json");

  it("opens an older manifest with no goal, upgrades it and loses no content", () => {
    const v12 = JSON.parse(v12Json);
    expect(v12.formatVersion).toBe(12);
    expect(v12).not.toHaveProperty("goal");

    const r = parseManifest(v12Json);
    expect(r.migrated).toBe(true);
    expect(r.fromVersion).toBe(12);
    expect(r.manifest.formatVersion).toBe(15);
    expect(r.manifest.goal).toBeUndefined();

    // Every entry, title, file and reference survives the upgrade unchanged.
    expect(readingOrder(r.manifest).map((e) => e.id)).toEqual(
      [...v12.frontMatter, ...v12.chapters, ...v12.backMatter].map((e: { id: string }) => e.id),
    );
    expect(r.manifest.frontMatter.map((e) => [e.id, e.kind, e.titles, e.files])).toEqual(
      v12.frontMatter.map((e: { id: string; kind: string; titles: unknown; files: unknown }) => [
        e.id,
        e.kind,
        e.titles,
        e.files,
      ]),
    );
    expect(r.manifest.chapters.map((e) => [e.id, e.kind, e.titles, e.files, e.icon])).toEqual(
      v12.chapters.map(
        (e: { id: string; kind?: string; titles: unknown; files: unknown; icon?: string }) => [
          e.id,
          e.kind,
          e.titles,
          e.files,
          e.icon,
        ],
      ),
    );
    expect(r.manifest.references).toEqual(v12.references);
    expect(r.manifest.editions).toEqual([
      expect.objectContaining({
        title: v12.editions[0].title,
        author: v12.editions[0].author,
        publishing: v12.editions[0].publishing,
      }),
    ]);
    expect(r.manifest.fonts).toEqual(v12.fonts);
    expect(r.manifest.trimSize).toBe(v12.trimSize);
    expect(r.manifest.dropCap).toBe(true);
    expect(r.manifest.frontMatter[1]!.toc).toMatchObject({
      depth: 1,
      custom: [{ id: "c-1", after: "ch-1", target: "ch-1" }],
    });
  });

  it("saves as version 15 and reopens without migrating again, with the same content", () => {
    const first = parseManifest(v12Json).manifest;
    const saved = serializeManifest(first);
    expect(JSON.parse(saved).formatVersion).toBe(15);
    const again = parseManifest(saved);
    expect(again.migrated).toBe(false);
    expect(again.manifest).toEqual(first);
  });

  it("then takes a goal and keeps all the content around it", () => {
    const m = parseManifest(v12Json).manifest;
    const withGoal = { ...m, goal: { words: 50000, deadline: "2027-01-31" } };
    const back = parseManifest(serializeManifest(withGoal)).manifest;
    expect(back.goal).toEqual({ words: 50000, deadline: "2027-01-31" });
    expect(back.references).toEqual(m.references);
    expect(back.chapters).toEqual(m.chapters);
    expect(back.frontMatter).toEqual(m.frontMatter);
  });
});
