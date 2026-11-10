import { daysBetween, isDateKey, shiftDateKey } from "../dates";

/** Net words the book gained on one calendar day (negative when it lost more than it gained). */
export interface DayWords {
  /** `YYYY-MM-DD`, the author's local day. */
  date: string;
  words: number;
}

/** The figures the History screen shows. Words are net: a day with cuts can have fewer words than the day before. */
export interface WritingSummary {
  today: number;
  /** Today and the six days before it. */
  last7Days: number;
  /** From the first of today's calendar month to today. */
  thisMonth: number;
  /** Consecutive days with more than zero words, ending today (or yesterday while today has none). */
  streak: number;
}

/**
 * Words per day as a map. Records with a date that is not a real `YYYY-MM-DD` are left out, and two records for one day add up.
 */
export function dayTotals(records: readonly DayWords[]): Map<string, number> {
  const totals = new Map<string, number>();
  for (const r of records) {
    if (!isDateKey(r.date)) continue;
    totals.set(r.date, (totals.get(r.date) ?? 0) + r.words);
  }
  return totals;
}

/** Consecutive days with more than zero words, counting back from today; from yesterday when today has none. */
export function streakEnding(totals: ReadonlyMap<string, number>, today: string): number {
  let day = (totals.get(today) ?? 0) > 0 ? today : shiftDateKey(today, -1);
  let days = 0;
  while ((totals.get(day) ?? 0) > 0) {
    days++;
    day = shiftDateKey(day, -1);
  }
  return days;
}

/** The History figures for `today` (a date key) from the day records. Days after today are not counted. */
export function summarizeWriting(records: readonly DayWords[], today: string): WritingSummary {
  const totals = dayTotals(records);
  const month = today.slice(0, 7);
  let last7Days = 0;
  let thisMonth = 0;
  for (const [date, words] of totals) {
    const ago = daysBetween(date, today);
    if (ago < 0) continue;
    if (ago <= 6) last7Days += words;
    if (date.startsWith(month)) thisMonth += words;
  }
  return {
    today: totals.get(today) ?? 0,
    last7Days,
    thisMonth,
    streak: streakEnding(totals, today),
  };
}
