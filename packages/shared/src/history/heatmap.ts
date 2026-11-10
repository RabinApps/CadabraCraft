import { daysBetween, shiftDateKey, weekdayOf } from "../dates";
import { dayTotals, type DayWords } from "./summary";

/** Weeks shown in the heatmap, the last one holding today. */
export const HEATMAP_WEEKS = 24;

/**
 * Intensity of a day, 0 to 4. The scale is fixed, not relative to the author's own totals, so one square means the same number
 * of words in every book and on every day: no words or a net loss is 0; 1 to 250 words is 1; 251 to 500 is 2; 501 to 1000 is 3;
 * more than 1000 is 4.
 */
export type HeatLevel = 0 | 1 | 2 | 3 | 4;

/** The inclusive upper word count of levels 1, 2 and 3. */
export const HEAT_LEVEL_TOPS = [250, 500, 1000] as const;

export function heatLevel(words: number): HeatLevel {
  if (words <= 0) return 0;
  const index = HEAT_LEVEL_TOPS.findIndex((top) => words <= top);
  return index < 0 ? 4 : ((index + 1) as HeatLevel);
}

export interface HeatCell {
  date: string;
  /** Net words that day; 0 for a day after today. */
  words: number;
  level: HeatLevel;
  /** True for a day after today (the rest of the current week). */
  future: boolean;
}

/**
 * The heatmap for `today`: `weeks[w][d]` is the cell of weekday `d` (0 Sunday to 6 Saturday) in week `w`. The first week is
 * `HEATMAP_WEEKS - 1` weeks before the one that holds today. Every cell has a date, so a day without words is an empty square.
 */
export function heatmapGrid(records: readonly DayWords[], today: string): HeatCell[][] {
  const totals = dayTotals(records);
  const thisSunday = shiftDateKey(today, -weekdayOf(today));
  const firstSunday = shiftDateKey(thisSunday, -7 * (HEATMAP_WEEKS - 1));
  return Array.from({ length: HEATMAP_WEEKS }, (_, week) =>
    Array.from({ length: 7 }, (_, weekday) => {
      const date = shiftDateKey(firstSunday, week * 7 + weekday);
      const future = daysBetween(today, date) > 0;
      const words = future ? 0 : (totals.get(date) ?? 0);
      return { date, words, level: heatLevel(words), future };
    }),
  );
}
