import { describe, expect, it } from "vitest";
import {
  createSprint,
  isSprintDone,
  pauseSprint,
  sprintElapsedMs,
  sprintRemainingMs,
  startSprint,
} from "../sprint";

const MIN = 60_000;

describe("sprint timer", () => {
  it("creates a stopped sprint of whole minutes", () => {
    expect(createSprint(25)).toEqual({ durationMs: 25 * MIN, elapsedMs: 0, runningSince: null });
    expect(() => createSprint(0)).toThrow("positive");
    expect(() => createSprint(-3)).toThrow("positive");
    expect(() => createSprint(Number.NaN)).toThrow("positive");
  });

  it("counts down while running and keeps the time when paused", () => {
    let s = startSprint(createSprint(10), 1_000);
    expect(sprintElapsedMs(s, 1_000 + 2 * MIN)).toBe(2 * MIN);
    expect(sprintRemainingMs(s, 1_000 + 2 * MIN)).toBe(8 * MIN);
    s = pauseSprint(s, 1_000 + 3 * MIN);
    expect(s.runningSince).toBeNull();
    expect(sprintElapsedMs(s, 1_000 + 9 * MIN)).toBe(3 * MIN);
  });

  it("resumes after a pause and adds the new run", () => {
    let s = startSprint(createSprint(10), 0);
    s = pauseSprint(s, MIN);
    s = startSprint(s, 5 * MIN);
    expect(sprintElapsedMs(s, 7 * MIN)).toBe(3 * MIN);
  });

  it("stops at the sprint length and reports done", () => {
    const s = startSprint(createSprint(1), 0);
    expect(sprintRemainingMs(s, 10 * MIN)).toBe(0);
    expect(sprintElapsedMs(s, 10 * MIN)).toBe(MIN);
    expect(isSprintDone(s, 10 * MIN)).toBe(true);
    expect(isSprintDone(s, 0)).toBe(false);
  });

  it("does not start a finished sprint or restart a running one", () => {
    const running = startSprint(createSprint(5), 0);
    expect(startSprint(running, MIN)).toBe(running);
    const done = pauseSprint(startSprint(createSprint(1), 0), 2 * MIN);
    expect(startSprint(done, 3 * MIN)).toBe(done);
  });

  it("pausing a stopped sprint returns it unchanged", () => {
    const s = createSprint(5);
    expect(pauseSprint(s, 99)).toBe(s);
  });

  it("never reports negative elapsed time when the clock goes back", () => {
    const s = startSprint(createSprint(5), 10 * MIN);
    expect(sprintElapsedMs(s, 0)).toBe(0);
  });
});
