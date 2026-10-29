/** `YYYYMMDD-HHMM` (UTC) as a local date and time. */
export function formatStamp(at: string, locale: string): string {
  const [y, mo, d, h, mi] = [
    at.slice(0, 4),
    at.slice(4, 6),
    at.slice(6, 8),
    at.slice(9, 11),
    at.slice(11, 13),
  ].map(Number) as [number, number, number, number, number];
  const date = new Date(Date.UTC(y, mo - 1, d, h, mi));
  try {
    return new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(
      date,
    );
  } catch {
    return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(
      date,
    ); // the pseudo locale is not a real one
  }
}
