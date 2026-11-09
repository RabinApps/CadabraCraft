import { afterEach, describe, expect, it, vi } from "vitest";
import { pauseSprint, startSprint } from "@cadabracraft/shared";
import { cleanSprint, newSprint, parseSprint, sprintMinutes } from "../view/sprintPrefs";
import { formatSprintClock } from "../view/sprintTime";

const KEY = "cadabracraft.settings";
const MIN = 60_000;

/** Loads a fresh copy of the settings store with `data` as the saved value. */
async function load(stored: string | null) {
  vi.resetModules();
  const data = new Map<string, string>();
  if (stored !== null) data.set(KEY, stored);
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => {
      data.set(k, v);
    },
  });
  const mod = await import("../view/editorPrefs");
  return { ...mod, data };
}
afterEach(() => vi.unstubAllGlobals());

describe("sprint lengths and cleaning", () => {
  it("makes a stopped sprint of an offered length, and the default for any other", () => {
    expect(newSprint(45)).toEqual({ durationMs: 45 * MIN, elapsedMs: 0, runningSince: null });
    expect(sprintMinutes(newSprint(15))).toBe(15);
    expect(sprintMinutes(newSprint(7))).toBe(25);
    expect(sprintMinutes(newSprint("x"))).toBe(25);
  });

  it("keeps a valid stored sprint and clamps the time run to the length", () => {
    expect(cleanSprint({ durationMs: 15 * MIN, elapsedMs: 99 * MIN, runningSince: 5 })).toEqual({
      durationMs: 15 * MIN,
      elapsedMs: 15 * MIN,
      runningSince: 5,
    });
    expect(cleanSprint({ durationMs: 25 * MIN, elapsedMs: -4, runningSince: null }).elapsedMs).toBe(
      0,
    );
  });

  it("falls back to a stopped 25-minute sprint for a length it does not offer or a bad shape", () => {
    for (const v of [null, "x", 42, { durationMs: 3 * MIN }, { durationMs: "25" }]) {
      expect(cleanSprint(v)).toEqual(newSprint(25));
    }
  });

  it("reads a running sprint back paused, keeping the time run before it started", () => {
    const parsed = parseSprint({ durationMs: 25 * MIN, elapsedMs: 3 * MIN, runningSince: 1_000 });
    expect(parsed).toEqual({ durationMs: 25 * MIN, elapsedMs: 3 * MIN, runningSince: null });
  });
});

describe("formatSprintClock", () => {
  it("shows mm:ss, rounding a partial second up", () => {
    expect(formatSprintClock(25 * MIN)).toBe("25:00");
    expect(formatSprintClock(24 * MIN + 11_200)).toBe("24:12");
    expect(formatSprintClock(500)).toBe("00:01");
    expect(formatSprintClock(0)).toBe("00:00");
    expect(formatSprintClock(-5)).toBe("00:00");
  });
});

describe("sprint preference in the settings store", () => {
  it("defaults to a stopped 25-minute sprint", async () => {
    const { useSettings } = await load(null);
    expect(useSettings.getState().sprint).toEqual(newSprint(25));
  });

  it("saves a running sprint with its start time, and a reload reads it back paused", async () => {
    const first = await load(null);
    const running = startSprint(newSprint(15), 10_000);
    first.useSettings.getState().set({ sprint: running });
    expect(JSON.parse(first.data.get(KEY) ?? "{}").sprint).toEqual(running);

    const second = await load(first.data.get(KEY) ?? null);
    expect(second.useSettings.getState().sprint).toEqual({ ...running, runningSince: null });
  });

  it("keeps a paused sprint's progress across a reload", async () => {
    const first = await load(null);
    const paused = pauseSprint(startSprint(newSprint(45), 0), 4 * MIN);
    first.useSettings.getState().set({ sprint: paused });
    const second = await load(first.data.get(KEY) ?? null);
    expect(second.useSettings.getState().sprint.elapsedMs).toBe(4 * MIN);
  });
});
