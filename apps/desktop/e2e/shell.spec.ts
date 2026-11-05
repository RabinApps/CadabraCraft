import { expect, test } from "./support/coverage";
import { fakeTauri } from "./support/fakeTauri";
import { chapterDoc, focusEnd, newProject, seedChapters } from "./support/helpers";

test.beforeEach(async ({ page }) => {
  await fakeTauri(page);
});

test("dark theme is applied and remembered", async ({ page }) => {
  await newProject(page);
  await page.getByRole("button", { name: "Settings" }).click();
  await page.getByRole("radio", { name: "Dark" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
});

test("phone layout reaches chapters through the sheet", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await newProject(page);
  await expect(page.getByRole("navigation", { name: "Chapters" })).toHaveCount(0);
  const toolbar = await page.getByRole("toolbar", { name: "Formatting" }).boundingBox();
  const editorBox = await page.locator(".ProseMirror").boundingBox();
  expect(toolbar!.y).toBeGreaterThan(editorBox!.y); // docked below the page on phones
  await page.getByRole("button", { name: "Show chapters" }).click();
  await page.getByRole("button", { name: "Add chapter" }).click();
  await expect(page.locator(".ProseMirror h1")).toHaveText("Chapter 2");
  await page.getByRole("button", { name: "Chapter One", exact: true }).click();
  await expect(page.getByRole("navigation", { name: "Chapters" })).toHaveCount(0);
  await expect(page.locator(".ProseMirror h1")).toHaveText("Chapter One");
});

test("the desktop sidebar resizes within its limits and remembers the width", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await newProject(page);
  const resizer = page.getByRole("separator", { name: "Resize chapter list" });
  const sidebar = page.getByRole("navigation", { name: "Chapters" });
  await expect(resizer).toHaveAttribute("aria-valuenow", "264");

  const handle = (await resizer.boundingBox())!;
  await page.mouse.move(handle.x + handle.width / 2, handle.y + 80);
  await page.mouse.down();
  await page.mouse.move(handle.x + handle.width / 2 + 60, handle.y + 80, { steps: 5 });
  await page.mouse.up();
  await expect(resizer).toHaveAttribute("aria-valuenow", "324");
  await expect.poll(async () => Math.round((await sidebar.boundingBox())!.width)).toBe(324);

  await resizer.focus();
  await page.keyboard.press("End");
  await expect(resizer).toHaveAttribute("aria-valuenow", "480");
  await page.keyboard.press("Home");
  await expect(resizer).toHaveAttribute("aria-valuenow", "220");
  await expect.poll(async () => Math.round((await sidebar.boundingBox())!.width)).toBe(220);

  await page.reload();
  await page.getByRole("button", { name: "Open folder" }).click();
  await expect(resizer).toHaveAttribute("aria-valuenow", "220");
  await expect.poll(async () => Math.round((await sidebar.boundingBox())!.width)).toBe(220);

  // The resizer belongs to the desktop column only; the chapter sheet keeps its own fixed width.
  await page.setViewportSize({ width: 820, height: 1180 });
  await expect(resizer).toBeHidden();
  await page.getByRole("button", { name: "Show chapters" }).click();
  const sheet = page.getByRole("dialog", { name: "Chapters" });
  await expect(sheet).toBeVisible();
  expect((await sheet.boundingBox())!.width).toBeGreaterThan(300);
});

test("a long chapter list scrolls inside the sidebar without scrolling the window", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await newProject(page);
  await seedChapters(
    page,
    Array.from({ length: 40 }, (_, i) => chapterDoc(`Chapter ${i + 1}`, 0)),
  );
  const sidebar = page.getByRole("navigation", { name: "Chapters" });
  const scroller = page.locator("[data-sidebar-entries]");
  await expect.poll(() => scroller.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true);
  expect(await page.evaluate(() => document.scrollingElement!.scrollHeight <= innerHeight)).toBe(
    true,
  );

  const box = (await sidebar.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(0, 5000);
  await expect.poll(() => scroller.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
  await scroller.evaluate((el) => (el.scrollTop = el.scrollHeight));
  await page.mouse.wheel(0, 1000);
  expect(await page.evaluate(() => scrollY)).toBe(0);
});

test("language picker switches the UI to the pseudo-locale and remembers it", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page.locator("html")).toHaveAttribute("dir", "ltr");
  await page.getByRole("button", { name: "Settings" }).click();
  await page.getByLabel("Interface language").selectOption("pseudo");
  await expect(page.getByRole("heading", { level: 1 })).not.toHaveText("Settings");
  await page.reload();
  await expect(page.getByRole("heading", { level: 1 })).not.toHaveText("Settings");
  expect(await page.evaluate(() => localStorage.getItem("cadabracraft.locale"))).toBe("pseudo");
});

test("focus mode hides the chrome, exits with Escape and is remembered", async ({ page }) => {
  await newProject(page);
  await expect(page.getByRole("navigation", { name: "Chapters" })).toBeVisible();
  await page.getByRole("button", { name: "Focus mode" }).click();
  await expect(page.getByRole("navigation", { name: "Chapters" })).toBeHidden();
  await expect(page.getByRole("button", { name: "Export", exact: true })).toBeHidden();
  await page.reload();
  await page.getByRole("button", { name: "Open folder" }).click();
  await expect(page.getByRole("button", { name: "Exit focus mode" })).toBeVisible();
  await page.locator(".ProseMirror").click();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Exit focus mode" })).toBeHidden();
  await expect(page.getByRole("navigation", { name: "Chapters" })).toBeVisible();
});

test("details panel shows page and book facts on desktop and can be hidden", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await newProject(page);
  const panel = page.getByRole("complementary", { name: "Details" });
  await expect(panel).toContainText("E2E Book");
  await expect(panel).toContainText("Tester");
  await expect(panel).toContainText("Chapter One");
  await focusEnd(page);
  await page.keyboard.type("alpha beta gamma");
  await expect(panel.getByText("Words").locator("xpath=following-sibling::dd")).not.toHaveText("0");
  await page.getByRole("button", { name: "Details", exact: true }).click();
  await expect(panel).toBeHidden();
});

test("details panel is not shown on a tablet", async ({ page }) => {
  await page.setViewportSize({ width: 820, height: 1180 });
  await newProject(page);
  await expect(page.getByRole("complementary", { name: "Details" })).toBeHidden();
});
