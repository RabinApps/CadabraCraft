const DAY = 24 * 60 * 60 * 1000;

const startOfDay = (ms: number) => {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};

/** "today", "yesterday", "3 days ago", "last week", "2 months ago": calendar days, in the given language. */
export function relativeTime(then: number, now: number, locale: string): string {
  const days = Math.max(0, Math.round((startOfDay(now) - startOfDay(then)) / DAY));
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  if (days < 7) return rtf.format(-days, "day");
  if (days < 30) return rtf.format(-Math.floor(days / 7), "week");
  if (days < 365) return rtf.format(-Math.floor(days / 30), "month");
  return rtf.format(-Math.floor(days / 365), "year");
}
