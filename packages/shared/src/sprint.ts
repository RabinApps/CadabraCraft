/**
 * Sprint timer (M03): a countdown that runs while the author writes, and pauses. Pure data and functions; the status
 * bar draws it. Times are epoch milliseconds passed in, so the logic is testable without a clock.
 */

export type Sprint = {
  /** Length of the sprint in milliseconds. */
  durationMs: number;
  /** Time already run before the current run started. */
  elapsedMs: number;
  /** Start time of the current run, or null while paused or stopped. */
  runningSince: number | null;
};

export function createSprint(minutes: number): Sprint {
  if (!Number.isFinite(minutes) || minutes <= 0)
    throw new Error("A sprint needs a positive number of minutes");
  return { durationMs: minutes * 60_000, elapsedMs: 0, runningSince: null };
}

/** Time run so far, counting the current run up to `now`. Never more than the sprint length. */
export function sprintElapsedMs(sprint: Sprint, now: number): number {
  const live = sprint.runningSince === null ? 0 : Math.max(0, now - sprint.runningSince);
  return Math.min(sprint.durationMs, sprint.elapsedMs + live);
}

export function sprintRemainingMs(sprint: Sprint, now: number): number {
  return sprint.durationMs - sprintElapsedMs(sprint, now);
}

export function isSprintDone(sprint: Sprint, now: number): boolean {
  return sprintRemainingMs(sprint, now) <= 0;
}

/** Starts or resumes the countdown. A finished sprint or one already running is returned unchanged. */
export function startSprint(sprint: Sprint, now: number): Sprint {
  if (sprint.runningSince !== null || isSprintDone(sprint, now)) return sprint;
  return { ...sprint, runningSince: now };
}

/** Pauses the countdown, keeping the time run so far. A paused sprint is returned unchanged. */
export function pauseSprint(sprint: Sprint, now: number): Sprint {
  if (sprint.runningSince === null) return sprint;
  return { ...sprint, elapsedMs: sprintElapsedMs(sprint, now), runningSince: null };
}
