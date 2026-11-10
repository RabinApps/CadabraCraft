/**
 * Calendar dates as `YYYY-MM-DD` text (a book deadline, a day of writing history). Pure: no clock and no time zone. Day arithmetic
 * runs in UTC on whole days, so it never depends on a daylight-saving change.
 */

const DATE_KEY = /^(\d{4})-(\d{2})-(\d{2})$/;
const DAY_MS = 86_400_000;

/** Milliseconds of midnight UTC on a calendar day, or NaN when the day does not exist (30 February). */
function utcMidnight(year: number, month: number, day: number): number {
  const t = new Date(0);
  t.setUTCFullYear(year, month - 1, day);
  const ok = t.getUTCFullYear() === year && t.getUTCMonth() === month - 1 && t.getUTCDate() === day;
  return ok ? t.getTime() : Number.NaN;
}

/** True for `YYYY-MM-DD` naming a real calendar day (leap years included). */
export function isDateKey(v: unknown): v is string {
  if (typeof v !== "string") return false;
  const m = DATE_KEY.exec(v);
  if (!m) return false;
  return !Number.isNaN(utcMidnight(Number(m[1]), Number(m[2]), Number(m[3])));
}

/** Whole days since 1970-01-01 of a date key. Throws when the text is not a real date. */
export function dayNumber(key: string): number {
  const m = DATE_KEY.exec(key);
  const ms = m ? utcMidnight(Number(m[1]), Number(m[2]), Number(m[3])) : Number.NaN;
  if (Number.isNaN(ms)) throw new RangeError(`not a calendar date: ${JSON.stringify(key)}`);
  return ms / DAY_MS;
}

/** The date key `days` whole days after `key` (before it when negative). */
export function shiftDateKey(key: string, days: number): string {
  return new Date((dayNumber(key) + days) * DAY_MS).toISOString().slice(0, 10);
}

/** Whole days from `from` to `to`: 0 for the same day, negative when `to` is earlier. */
export function daysBetween(from: string, to: string): number {
  return dayNumber(to) - dayNumber(from);
}

/** Day of the week of a date key, 0 for Sunday to 6 for Saturday. */
export function weekdayOf(key: string): number {
  return new Date(dayNumber(key) * DAY_MS).getUTCDay();
}
