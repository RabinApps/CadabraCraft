import { expect, test } from "./support/coverage";
import { fakeTauri } from "./support/fakeTauri";
import { newProject } from "./support/helpers";

test.beforeEach(async ({ page }) => {
  await fakeTauri(page);
});

test("word count follows typing", async ({ page }) => {
  await newProject(page);
  await expect(page.getByText("2 words in this chapter")).toBeVisible(); // the "Chapter One" heading
  await page.locator(".ProseMirror").click();
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.type("one two three");
  await expect(page.getByText("5 words in this chapter")).toBeVisible();
});

test("reading mode is read-only, shows unsaved typing and moves between chapters", async ({
  page,
}) => {
  await newProject(page);
  await page.getByRole("button", { name: "Add chapter" }).click();
  await page.getByRole("button", { name: "Chapter One", exact: true }).click();
  await page.locator(".ProseMirror").click();
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.type("Hello reading");
  await page.getByRole("radio", { name: "Read" }).click();
  await expect(page.locator(".ProseMirror")).toContainText("Hello reading");
  await expect(page.locator(".ProseMirror")).toHaveAttribute("contenteditable", "false");
  await expect(page.getByRole("toolbar", { name: "Formatting" })).toHaveCount(0);
  await expect(page.getByText("Chapter 1 of 2")).toBeVisible();
  await page.getByRole("button", { name: "Next chapter" }).click();
  await expect(page.locator(".ProseMirror h1")).toHaveText("Chapter 2");
  await expect(page.getByText("Chapter 2 of 2")).toBeVisible();
  await page.getByRole("button", { name: "Reading settings" }).click();
  await page.getByRole("menuitem", { name: "Larger text" }).click();
  await page.keyboard.press("Escape");
  await page.getByRole("radio", { name: "Write" }).click();
  await expect(page.getByRole("toolbar", { name: "Formatting" })).toBeVisible();
  const saved = await page.evaluate(() =>
    Object.values(window.__disk)
      .filter((v) => typeof v === "string")
      .join("\n"),
  );
  expect(saved).toContain("Hello reading");
});
