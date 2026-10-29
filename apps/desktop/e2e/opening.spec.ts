import { expect, test } from "./support/coverage";
import { fakeTauri } from "./support/fakeTauri";
import { newProject } from "./support/helpers";

test.beforeEach(async ({ page }) => {
  await fakeTauri(page);
});

const SIZES = [
  { name: "desktop", width: 1280, height: 800 },
  { name: "phone", width: 390, height: 780 },
];

for (const size of SIZES) {
  test.describe(`opening a project at ${size.name} width`, () => {
    test.use({ viewport: { width: size.width, height: size.height } });

    test("shows the loading skeleton until the book is ready, then the editor", async ({
      page,
    }) => {
      await newProject(page);
      await page.reload();
      // Hold the manifest read so the skeleton can be looked at.
      await page.evaluate(() => {
        window.__manifestGate = new Promise<void>((r) => (window.__manifestRelease = r));
      });
      await page
        .getByRole("region", { name: "Recent projects" })
        .getByRole("button", { name: /E2E Book/ })
        .first()
        .click();
      const skeleton = page.getByRole("status", { name: "Opening E2E Book" });
      await expect(skeleton).toBeVisible();
      await expect(page.getByRole("heading", { name: "E2E Book" })).toHaveCount(0); // decorative title is hidden from the tree
      await expect(page.getByRole("region", { name: "Recent projects" })).toHaveCount(0);
      // The sidebar is not squeezed in on narrow screens, like the real shell.
      const sidebarShown = size.width >= 1024;
      await expect(page.locator("aside")).toHaveCount(1);
      await expect(page.locator("aside")).toBeVisible({ visible: sidebarShown });
      await page.evaluate(() => window.__manifestRelease?.());
      await expect(page.locator(".ProseMirror h1")).toHaveText("Chapter One");
      await expect(skeleton).toHaveCount(0);
    });

    test("a failed open replaces the skeleton with the error", async ({ page }) => {
      await newProject(page);
      await page.reload();
      await page.evaluate(() => {
        localStorage.setItem(
          "cadabracraft.recents",
          JSON.stringify([{ root: "/gone", title: "Moved Book", openedAt: 1 }]),
        );
        window.__manifestGate = new Promise<void>((r) => (window.__manifestRelease = r));
      });
      await page.reload();
      await page.evaluate(() => {
        window.__manifestGate = new Promise<void>((r) => (window.__manifestRelease = r));
      });
      const recent = page.getByRole("region", { name: "Recent projects" });
      await recent
        .getByRole("button", { name: /Moved Book/ })
        .first()
        .click();
      await expect(page.getByRole("status", { name: "Opening Moved Book" })).toBeVisible();
      await page.evaluate(() => window.__manifestRelease?.());
      await expect(recent.getByText("Folder not found.")).toBeVisible();
      await expect(page.getByRole("status", { name: /Opening/ })).toHaveCount(0);
    });
  });
}

test("the skeleton does not pulse when the system asks for reduced motion", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await newProject(page);
  await page.reload();
  await page.evaluate(() => {
    window.__manifestGate = new Promise<void>((r) => (window.__manifestRelease = r));
  });
  await page
    .getByRole("region", { name: "Recent projects" })
    .getByRole("button", { name: /E2E Book/ })
    .first()
    .click();
  await expect(page.getByRole("status", { name: "Opening E2E Book" })).toBeVisible();
  const still = await page
    .locator(".skeleton")
    .first()
    .evaluate((el) => getComputedStyle(el).animationName);
  expect(still).toBe("none");
  await page.evaluate(() => window.__manifestRelease?.());
  await expect(page.locator(".ProseMirror h1")).toHaveText("Chapter One");
});
