import { expect, test, type Page } from "@playwright/test";
import { fakeTauri } from "./support/fakeTauri";
import { newProject } from "./support/helpers";

test.beforeEach(async ({ page }) => {
  await fakeTauri(page);
});

test.describe("sponsor dialog after an export", () => {
  test.beforeEach(async ({ page }) => {
    // Registered after the fake backend's script, so it runs after it and turns the dialog back on.
    await page.addInitScript(() => {
      if (sessionStorage.getItem("sponsorTest")) return; // only on the first load, so a reload keeps what the author chose
      sessionStorage.setItem("sponsorTest", "1");
      localStorage.removeItem("cadabracraft.sponsor");
    });
  });
  const exportEpub = async (page: Page) => {
    await page.getByRole("button", { name: "Export", exact: true }).click();
    await page.getByRole("dialog", { name: "Export book" }).getByRole("button", { name: "Export", exact: true }).click();
  };
  const sponsor = (page: Page) => page.getByRole("dialog", { name: "Enjoying CadabraCraft?" });

  test("appears after a successful export with the file name and three choices", async ({ page }) => {
    await newProject(page);
    await exportEpub(page);
    await expect(sponsor(page)).toBeVisible();
    await expect(sponsor(page).getByText("Exported exports/book.epub")).toBeVisible();
    for (const name of ["Don't show again", "Maybe later", "Sponsor"]) await expect(sponsor(page).getByRole("button", { name })).toBeVisible();
  });

  test("Maybe later hides it for the rest of the session only", async ({ page }) => {
    await newProject(page);
    await exportEpub(page);
    await sponsor(page).getByRole("button", { name: "Maybe later" }).click();
    await expect(sponsor(page)).toHaveCount(0);
    await exportEpub(page);
    await expect(page.getByRole("status")).toHaveText("Exported exports/book.epub");
    await expect(sponsor(page)).toHaveCount(0);
    expect(await page.evaluate(() => localStorage.getItem("cadabracraft.sponsor"))).toBeNull();
  });

  test("closing it with Escape asks again after the next export", async ({ page }) => {
    await newProject(page);
    await exportEpub(page);
    await page.keyboard.press("Escape");
    await expect(sponsor(page)).toHaveCount(0);
    await exportEpub(page);
    await expect(sponsor(page)).toBeVisible();
  });

  test("Don't show again is remembered across restarts", async ({ page }) => {
    await newProject(page);
    await exportEpub(page);
    await sponsor(page).getByRole("button", { name: "Don't show again" }).click();
    await expect(sponsor(page)).toHaveCount(0);
    expect(await page.evaluate(() => localStorage.getItem("cadabracraft.sponsor"))).toBe("hidden");
    await page.reload();
    await page.getByRole("button", { name: "Open folder" }).click();
    await expect(page.locator(".ProseMirror")).toBeVisible();
    await exportEpub(page);
    await expect(page.getByRole("status")).toHaveText("Exported exports/book.epub");
    await expect(sponsor(page)).toHaveCount(0);
  });

  test("Sponsor opens only the sponsor page in the browser and closes the dialog", async ({ page }) => {
    await newProject(page);
    await exportEpub(page);
    await sponsor(page).getByRole("button", { name: "Sponsor", exact: true }).click();
    await expect(sponsor(page)).toHaveCount(0);
    expect(await page.evaluate(() => (window as any).__opened)).toEqual(["https://github.com/sponsors/RabinApps"]);
  });

  test("does not appear when the export fails", async ({ page }) => {
    await newProject(page);
    await page.getByRole("button", { name: "Export", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Export book" });
    await dialog.getByRole("radio", { name: "Print PDF" }).click();
    await page.evaluate(() => { (window as any).__compileError = { kind: "compile", message: "main.typ:1:1: error: boom" }; });
    await dialog.getByRole("button", { name: "Export", exact: true }).click();
    await expect(dialog.getByRole("alert")).toBeVisible();
    await expect(sponsor(page)).toHaveCount(0);
  });
});
