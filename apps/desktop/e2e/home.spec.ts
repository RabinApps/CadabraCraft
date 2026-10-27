import { expect, test } from "@playwright/test";
import { fakeTauri } from "./support/fakeTauri";
import { newProject } from "./support/helpers";

test.beforeEach(async ({ page }) => {
  await fakeTauri(page);
});

test("recent projects: listed after opening, reopenable, removable, and missing folders are flagged", async ({ page }) => {
  await newProject(page);
  await page.reload();
  const recent = page.getByRole("region", { name: "Recent projects" });
  await expect(recent.getByText("E2E Book")).toBeVisible();
  // Never written into the project file.
  expect(await page.evaluate(() => (window as any).__disk["cadabra.json"])).not.toContain("/proj");
  await recent.getByRole("button", { name: /E2E Book/ }).first().click();
  await expect(page.locator(".ProseMirror h1")).toHaveText("Chapter One");

  await page.evaluate(() => localStorage.setItem("cadabracraft.recents", JSON.stringify([
    { root: "/gone", title: "Moved Book", openedAt: 2 }, { root: "/proj", title: "E2E Book", openedAt: 1 },
  ])));
  await page.reload();
  await recent.getByRole("button", { name: /Moved Book/ }).first().click();
  await expect(recent.getByText("Folder not found.")).toBeVisible();
  await page.getByRole("button", { name: "Remove Moved Book from recent projects" }).click();
  await expect(recent.getByText("Moved Book")).toHaveCount(0);
  await expect(recent.getByText("E2E Book")).toBeVisible();
});
