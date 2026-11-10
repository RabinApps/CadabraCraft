import { describe, expect, it } from "vitest";
import { MAX_GOAL_WORDS } from "@cadabracraft/format";
import { goalFromForm, goalProblem, goalToForm, goalView, localDateKey } from "../goalForm";

describe("goalToForm and goalFromForm", () => {
  it("starts an empty form when there is no goal", () => {
    expect(goalToForm(undefined)).toEqual({ words: "", deadline: "" });
  });

  it("round-trips a goal with and without a deadline", () => {
    expect(goalToForm({ words: 50_000, deadline: "2027-03-01" })).toEqual({
      words: "50000",
      deadline: "2027-03-01",
    });
    const plain = goalFromForm({ words: " 1200 ", deadline: "" });
    expect(plain).toEqual({ words: 1200 });
    expect("deadline" in plain).toBe(false);
  });
});

describe("goalProblem", () => {
  it("accepts whole word counts from 1 to the maximum, with an optional date", () => {
    expect(goalProblem({ words: "1", deadline: "" })).toBeNull();
    expect(goalProblem({ words: String(MAX_GOAL_WORDS), deadline: "2028-02-29" })).toBeNull();
  });

  it("names the words field when the count is empty, fractional, zero, negative or too large", () => {
    for (const words of ["", "0", "-4", "2.5", "1e3", "abc", String(MAX_GOAL_WORDS + 1)])
      expect(goalProblem({ words, deadline: "" })).toBe("words");
  });

  it("names the deadline field when the date does not exist", () => {
    expect(goalProblem({ words: "10", deadline: "2027-02-30" })).toBe("deadline");
    expect(goalProblem({ words: "10", deadline: "yesterday" })).toBe("deadline");
  });
});

describe("goalView", () => {
  it("gives the share written and the daily plan from the book's word count", () => {
    const view = goalView({ words: 1000, deadline: "2027-01-10" }, 250, "2027-01-01");
    expect(view.percent).toBe(25);
    expect(view.plan).toMatchObject({ remaining: 750, met: false, daysLeft: 10, wordsPerDay: 75 });
  });

  it("caps the share at 100 and reports the goal met", () => {
    const view = goalView({ words: 1000 }, 1400, "2027-01-01");
    expect(view.percent).toBe(100);
    expect(view.plan).toMatchObject({ remaining: 0, met: true, daysLeft: null });
  });

  it("reports a late goal once the deadline has passed", () => {
    const view = goalView({ words: 1000, deadline: "2026-12-31" }, 400, "2027-01-02");
    expect(view.plan).toMatchObject({ late: true, wordsPerDay: 600 });
  });
});

describe("localDateKey", () => {
  it("formats the local calendar day as YYYY-MM-DD with zero padding", () => {
    expect(localDateKey(new Date(2027, 0, 5, 23, 59))).toBe("2027-01-05");
    expect(localDateKey(new Date(2026, 11, 31, 0, 1))).toBe("2026-12-31");
  });
});
