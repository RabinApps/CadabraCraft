import { createSprint, type Sprint } from "@cadabracraft/shared";

/** Sprint lengths the author can choose, in minutes. */
export const SPRINT_MINUTES = [15, 25, 45] as const;
export type SprintMinutes = (typeof SPRINT_MINUTES)[number];
export const DEFAULT_SPRINT_MINUTES: SprintMinutes = 25;

const MINUTE_MS = 60_000;

/** A stopped sprint of `minutes`, or of the default length when `minutes` is not one of the offered lengths. */
export function newSprint(minutes: unknown): Sprint {
  const m = SPRINT_MINUTES.includes(minutes as SprintMinutes)
    ? (minutes as SprintMinutes)
    : DEFAULT_SPRINT_MINUTES;
  return createSprint(m);
}

/** The offered length a sprint was made with. */
export const sprintMinutes = (sprint: Sprint): SprintMinutes =>
  Math.round(sprint.durationMs / MINUTE_MS) as SprintMinutes;

const finiteOr = (v: unknown, fallback: number | null): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : fallback;

/** A stored sprint in the expected shape, with the time run kept within the length; the default stopped sprint otherwise. */
export function cleanSprint(v: unknown): Sprint {
  const o = v as Partial<Record<keyof Sprint, unknown>> | null;
  if (!o || typeof o !== "object") return newSprint(DEFAULT_SPRINT_MINUTES);
  const minutes = typeof o.durationMs === "number" ? o.durationMs / MINUTE_MS : NaN;
  if (!SPRINT_MINUTES.includes(minutes as SprintMinutes)) return newSprint(DEFAULT_SPRINT_MINUTES);
  const durationMs = minutes * MINUTE_MS;
  const elapsed = Math.min(durationMs, Math.max(0, finiteOr(o.elapsedMs, 0) ?? 0));
  return { durationMs, elapsedMs: elapsed, runningSince: finiteOr(o.runningSince, null) };
}

/** A sprint read back from storage. One that was running is read as paused: the time since its last start is not counted. */
export const parseSprint = (v: unknown): Sprint => ({ ...cleanSprint(v), runningSince: null });
