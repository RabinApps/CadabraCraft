import { expect, test, type Page } from "./support/coverage";
import { menu } from "./support/a11yScreenHelpers";
import { fakeTauri } from "./support/fakeTauri";
import { newProject } from "./support/helpers";
import { dayKey, seedWritingStats } from "./support/writingStats";

// File > Writing history… (also in the command palette): the words written per day, read from stats.json (M02).

test.beforeEach(async ({ page }) => {
  await fakeTauri(page);
});

const dialog = (page: Page) => page.getByRole("dialog", { name: "History" });
const figures = (page: Page) => dialog(page).locator("dd");

test("the History screen shows today, the week, the month, the streak and the heatmap for the stats file", async ({
  page,
}) => {
  const days: Record<string, number> = {
    [dayKey(0)]: 612,
    [dayKey(-1)]: 300,
    [dayKey(-3)]: 200, // within the seven days
    [dayKey(-10)]: 900, // before the week; in this month only when the month has enough days
  };
  await newProject(page);
  await seedWritingStats(page, days);
  await menu(page, "file.writingHistory");
  await expect(dialog(page)).toBeVisible();

  const fmt = (n: number) => new Intl.NumberFormat("en-US").format(n);
  const month = Object.entries(days)
    .filter(([day]) => day.startsWith(dayKey(0).slice(0, 7)))
    .reduce((sum, [, words]) => sum + words, 0);
  await expect(figures(page).nth(0)).toHaveText(`${fmt(612)} words`);
  await expect(figures(page).nth(1)).toHaveText(`${fmt(612 + 300 + 200)} words`);
  await expect(figures(page).nth(2)).toHaveText(`${fmt(month)} words`);
  await expect(figures(page).nth(3)).toHaveText("2 days");

  const heatmap = dialog(page).getByRole("table", { name: "Last 24 weeks" });
  await expect(heatmap).toBeVisible();
  await expect(heatmap.getByRole("img", { name: `612 words on ${dayKey(0)}` })).toBeVisible();
  await expect(heatmap.getByRole("img", { name: `300 words on ${dayKey(-1)}` })).toBeVisible();
  await expect(heatmap.getByRole("img", { name: `200 words on ${dayKey(-3)}` })).toBeVisible();
  await expect(dialog(page).getByText("Darker squares have more words.")).toBeVisible();
});

test("a stats file that cannot be read is kept as a copy and the screen starts from an empty history", async ({
  page,
}) => {
  await newProject(page);
  await page.evaluate(() => {
    const disk = window.__disk;
    disk["stats.json"] = "{ this is not a history";
    sessionStorage.setItem("disk", JSON.stringify(disk));
  });
  await menu(page, "file.writingHistory");
  await expect(dialog(page)).toBeVisible();
  await expect(figures(page).nth(0)).toHaveText("0 words");
  await expect(figures(page).nth(3)).toHaveText("0 days");
  await expect(dialog(page).getByRole("status")).toContainText("stats.json.corrupt-");
  const kept = await page.evaluate(() =>
    Object.entries(window.__disk).find(([name]) => name.startsWith("stats.json.corrupt-")),
  );
  expect(kept?.[1]).toBe("{ this is not a history");
});

test("each save adds the words typed since the previous save to today", async ({ page }) => {
  await newProject(page);
  const todayWords = async () => {
    await menu(page, "file.writingHistory");
    await expect(dialog(page)).toBeVisible();
    const text = (await figures(page).nth(0).textContent()) ?? "";
    await page.keyboard.press("Escape");
    await expect(dialog(page)).toBeHidden();
    return Number(text.split(" ")[0]!.replace(/,/g, ""));
  };
  await page.locator(".ProseMirror").first().click();
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.type(" alpha beta gamma delta epsilon");
  await menu(page, "file.save");
  await expect(page.getByRole("status").filter({ hasText: /^Saved$/ })).toBeVisible();
  // The first save may also count the new chapter's title, so the test compares with what the screen showed before.
  await expect.poll(todayWords).toBeGreaterThanOrEqual(5);
  const first = await todayWords();
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.type(" one two three");
  await menu(page, "file.save");
  await expect(page.getByRole("status").filter({ hasText: /^Saved$/ })).toBeVisible();
  await expect.poll(todayWords).toBe(first + 3);
});
