import { daysBetween, isDateKey } from "@cadabracraft/shared";
import { FormatError } from "../errors";

/**
 * The author's writing goal for one book (formatVersion 13). It belongs to the book, so it lives in the manifest and travels with the
 * folder. The daily plan is derived from it and is never stored.
 */
export interface BookGoal {
  /** The book's word target: a positive integer. */
  words: number;
  /** The date the goal is due, `YYYY-MM-DD`. Absent means no deadline. */
  deadline?: string;
}

/** Largest word target a goal may hold. */
export const MAX_GOAL_WORDS = 10_000_000;

const GOAL_KEYS = ["words", "deadline"] as const;

/** Validates `manifest.goal`. Throws FormatError; unknown keys are refused so a typo is never silently lost. */
export function validateGoal(v: unknown, name = "goal"): BookGoal {
  if (typeof v !== "object" || v === null || Array.isArray(v))
    throw new FormatError(`manifest: "${name}" must be an object`);
  const o = v as Record<string, unknown>;
  for (const k of Object.keys(o))
    if (!(GOAL_KEYS as readonly string[]).includes(k))
      throw new FormatError(`manifest: unknown key "${name}.${k}"`);
  const { words, deadline } = o;
  if (
    typeof words !== "number" ||
    !Number.isSafeInteger(words) ||
    words < 1 ||
    words > MAX_GOAL_WORDS
  )
    throw new FormatError(
      `manifest: "${name}.words" must be a whole number from 1 to ${MAX_GOAL_WORDS}`,
    );
  if (deadline === undefined) return { words };
  if (!isDateKey(deadline))
    throw new FormatError(`manifest: "${name}.deadline" must be a date as YYYY-MM-DD`);
  return { words, deadline };
}

/** What the author still has to do to reach a goal. Every figure is derived; nothing here is stored. */
export interface DailyPlan {
  /** Words still to write to reach the target; 0 once it is met. */
  remaining: number;
  /** The goal is met. */
  met: boolean;
  /** Days from today through the deadline, both ends counted; 0 once the deadline has passed. Null without a deadline. */
  daysLeft: number | null;
  /** Words to write each day to finish by the deadline (rounded up). Once the deadline has passed it is the whole remainder. Null without a deadline. */
  wordsPerDay: number | null;
  /** The deadline passed before the goal was met. */
  late: boolean;
}

/**
 * The plan for `goal` given the book's current word count and today's date (`YYYY-MM-DD`, passed in so the function stays pure).
 * Today counts as a day to write, so a deadline of today leaves one day.
 */
export function dailyPlan(goal: BookGoal, bookWords: number, today: string): DailyPlan {
  if (!Number.isSafeInteger(bookWords) || bookWords < 0)
    throw new RangeError("the book's word count must be a whole number, zero or more");
  if (!isDateKey(today)) throw new RangeError(`not a calendar date: ${JSON.stringify(today)}`);
  const remaining = Math.max(0, goal.words - bookWords);
  const met = remaining === 0;
  if (goal.deadline === undefined)
    return { remaining, met, daysLeft: null, wordsPerDay: null, late: false };
  const days = daysBetween(today, goal.deadline) + 1;
  if (days <= 0) return { remaining, met, daysLeft: 0, wordsPerDay: remaining, late: !met };
  return { remaining, met, daysLeft: days, wordsPerDay: Math.ceil(remaining / days), late: false };
}
