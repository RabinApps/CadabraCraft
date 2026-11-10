import type { Page } from "@playwright/test";

/** The local date `offset` days from today as `YYYY-MM-DD` (the app counts days in the author's local time too). */
export function dayKey(offset: number): string {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Writes `stats.json` into the fake project folder of the open book: the net words of each day. */
export async function seedWritingStats(page: Page, days: Record<string, number>) {
  await page.evaluate((d) => {
    const disk = window.__disk;
    disk["stats.json"] = JSON.stringify({ version: 1, days: d, lastTotal: 1000 });
    sessionStorage.setItem("disk", JSON.stringify(disk));
  }, days);
}
