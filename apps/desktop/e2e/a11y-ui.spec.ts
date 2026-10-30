import { expect, test, type Page } from "./support/coverage";
import { fakeTauri } from "./support/fakeTauri";
import { newProject } from "./support/helpers";

test.beforeEach(async ({ page }) => {
  await fakeTauri(page);
});

const PIXEL = Array.from(
  atob(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  ),
  (c) => c.charCodeAt(0),
);
const panel = (page: Page) => page.getByRole("region", { name: "References" });

async function withThreeReferences(page: Page) {
  await newProject(page);
  await page.evaluate(
    ([paths, contents]) => {
      window.__pickedRefs = [...paths] as string[];
      window.__refFiles = contents as Record<string, number[]>;
    },
    [
      ["/refs/one.png", "/refs/two.png", "/refs/three.png"],
      {
        "/refs/one.png": PIXEL,
        "/refs/two.png": PIXEL.slice(0, 60).concat([1]),
        "/refs/three.png": PIXEL.slice(0, 50).concat([2, 3]),
      },
    ] as const,
  );
  await page.getByRole("button", { name: "References", exact: true }).first().click();
  await page.getByRole("button", { name: "Add files" }).click();
  await expect(panel(page).getByRole("listitem")).toHaveCount(3);
}

const order = (page: Page) => panel(page).locator("[data-title]").allTextContents();

test("reference grip is a button that reorders with the arrow keys and keeps focus", async ({
  page,
}) => {
  await withThreeReferences(page);
  const grip = (name: string) => panel(page).getByRole("button", { name: `Reorder ${name}` });
  await expect(grip("one")).toHaveAttribute("aria-keyshortcuts", "ArrowUp ArrowDown");
  await grip("one").focus();
  await page.keyboard.press("ArrowDown");
  await expect.poll(() => order(page)).toEqual(["two", "one", "three"]);
  await expect(grip("one")).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect.poll(() => order(page)).toEqual(["two", "three", "one"]);
  await page.keyboard.press("ArrowDown"); // already last: nothing happens
  await page.keyboard.press("ArrowUp");
  await expect.poll(() => order(page)).toEqual(["two", "one", "three"]);
  await expect(grip("one")).toBeFocused();
});

test("a reference row is named by its title and described by its kind", async ({ page }) => {
  await withThreeReferences(page);
  const open = panel(page).getByRole("button", { name: "one", exact: true });
  await expect(open).toHaveAccessibleDescription(/Image/);
  await expect(open).not.toHaveAttribute("aria-label");
});

test("field borders have at least 3:1 contrast with the surface", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "New project" }).click();
  const dialog = page.getByRole("dialog", { name: "New book" });
  const [border, fill] = await dialog
    .getByLabel("Title")
    .evaluate((el) => [getComputedStyle(el).borderTopColor, getComputedStyle(el).backgroundColor]);
  const lum = (c: string) => {
    const [r, g, b] = (c.match(/[\d.]+/g) ?? []).slice(0, 3).map((v) => {
      const x = Number(v) / 255;
      return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
  };
  const [hi, lo] = [lum(border!), lum(fill!)].sort((x, y) => y - x);
  expect((hi! + 0.05) / (lo! + 0.05)).toBeGreaterThanOrEqual(3);
});

test("forced-colors and increased contrast keep soft fills visible", async ({ page }) => {
  await withThreeReferences(page);
  const icon = panel(page).locator("[data-open] > span").first();
  await page.emulateMedia({ forcedColors: "active" });
  await expect(icon).toHaveCSS("border-top-style", "solid");
  await page.emulateMedia({ forcedColors: "none", contrast: "more" });
  await expect(icon).toHaveCSS("outline-style", "solid");
});

test.describe("header notice", () => {
  const status = (page: Page) => page.getByRole("banner").getByRole("status");

  test("a Saved notice does not replace another message, which can be dismissed", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await newProject(page);
    const nav = page.getByRole("navigation", { name: "Chapters" });
    await page.getByRole("button", { name: "Add chapter" }).click();
    await expect(page.locator(".ProseMirror h1")).toHaveText("Chapter 2");
    await nav.getByRole("button", { name: /^Undo/ }).click();
    await expect(status(page)).toContainText("Undid:");
    const message = (await status(page).textContent())!;
    // Typing autosaves after 2 seconds; the message must survive the save, in full.
    await page.locator(".ProseMirror").click();
    await page.keyboard.type(" more");
    await page.waitForTimeout(2600);
    await expect(status(page)).toHaveText(message);
    await page.getByRole("button", { name: "Dismiss message" }).click();
    await expect(status(page)).toHaveText("");
    await expect(page.getByRole("button", { name: "Dismiss message" })).toHaveCount(0);
  });

  test("a Saved notice shows when nothing else is there", async ({ page }) => {
    await newProject(page);
    await page.locator(".ProseMirror").click();
    await page.keyboard.type(" more");
    await expect(status(page)).toHaveText("Saved", { timeout: 6000 });
  });
});

test.describe("skip link and landmarks", () => {
  test("the first Tab stop skips to main on the home screen", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("main")).toBeVisible();
    await page.keyboard.press("Tab");
    const skip = page.getByRole("link", { name: "Skip to main content" });
    await expect(skip).toBeFocused();
    await expect(skip).toBeVisible();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("main")).toBeFocused();
  });

  test("the book view has banner, navigation, main and complementary landmarks", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1400, height: 900 });
    await newProject(page);
    await expect(page.getByRole("banner")).toHaveCount(1);
    await expect(page.getByRole("navigation", { name: "Chapters" })).toBeVisible();
    await expect(page.getByRole("main")).toHaveCount(1);
    await expect(page.getByRole("complementary", { name: "Details" })).toBeVisible();
    await page.getByRole("link", { name: "Skip to main content" }).focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("main")).toBeFocused();
  });

  test("settings has a main landmark", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Settings" }).click();
    await expect(page.getByRole("main")).toHaveAttribute("id", "main");
  });
});
