import { expect, test } from "./support/coverage";
import { fakeTauri } from "./support/fakeTauri";
import { newProject, focusEnd } from "./support/helpers";

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
