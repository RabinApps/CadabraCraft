import { expect, test, type Page } from "./support/coverage";
import { fakeTauri } from "./support/fakeTauri";
import { newProject } from "./support/helpers";

// Page view: the header toggle, the View menu command (the dev build exposes what each native menu item runs; the native
// accelerator CmdOrCtrl+Shift+P is that menu item's), the zoom select and where it is offered.

type MenuRun = { run: (id: string) => boolean };
const menu = async (page: Page, id: string) => {
  await page.waitForFunction(() =>
    Boolean((window as unknown as { __cadabraMenu?: MenuRun }).__cadabraMenu),
  );
  return page.evaluate(
    (i) => (window as unknown as { __cadabraMenu: MenuRun }).__cadabraMenu.run(i),
    id,
  );
};
const toggle = (page: Page) => page.getByRole("button", { name: "Page view", exact: true });
const zoom = (page: Page) => page.getByLabel("Page zoom");

test.beforeEach(async ({ page }) => {
  await fakeTauri(page);
});

test("the header toggle turns Page view on and off and is remembered", async ({ page }) => {
  await newProject(page);
  await expect(toggle(page)).toHaveAttribute("aria-pressed", "false");
  await expect(zoom(page)).toBeHidden();
  await toggle(page).click();
  await expect(toggle(page)).toHaveAttribute("aria-pressed", "true");
  await expect(zoom(page)).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: "Open folder" }).click();
  await expect(toggle(page)).toHaveAttribute("aria-pressed", "true");
  await toggle(page).click();
  await expect(toggle(page)).toHaveAttribute("aria-pressed", "false");
  await expect(zoom(page)).toBeHidden();
});

test("the View menu command (Cmd/Ctrl+Shift+P) toggles it", async ({ page }) => {
  await newProject(page);
  expect(await menu(page, "view.pageView")).toBe(true);
  await expect(toggle(page)).toHaveAttribute("aria-pressed", "true");
  expect(await menu(page, "view.pageView")).toBe(true);
  await expect(toggle(page)).toHaveAttribute("aria-pressed", "false");
});

test("the zoom select offers Fit width, 75%, 100% and 125% and is remembered", async ({ page }) => {
  await newProject(page);
  await toggle(page).click();
  await expect(zoom(page)).toHaveValue("fit");
  await expect(zoom(page).locator("option")).toHaveText(["Fit width", "75%", "100%", "125%"]);
  await zoom(page).selectOption({ label: "125%" });
  await page.reload();
  await page.getByRole("button", { name: "Open folder" }).click();
  await expect(zoom(page)).toHaveValue("1.25");
  await zoom(page).selectOption({ label: "Fit width" });
  await expect(zoom(page)).toHaveValue("fit");
});

test("it is not offered in Read mode, and comes back in Write mode", async ({ page }) => {
  await newProject(page);
  await toggle(page).click();
  await page.getByRole("radio", { name: "Read" }).click();
  await expect(page.locator(".ProseMirror")).toHaveAttribute("contenteditable", "false");
  await expect(toggle(page)).toHaveCount(0);
  await expect(zoom(page)).toHaveCount(0);
  await page.getByRole("radio", { name: "Write" }).click();
  await expect(toggle(page)).toHaveAttribute("aria-pressed", "true");
  await expect(zoom(page)).toBeVisible();
});

test("it is not offered on a phone, and the preference stays for the desktop", async ({ page }) => {
  await newProject(page);
  await toggle(page).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(toggle(page)).toBeHidden();
  await expect(zoom(page)).toBeHidden();
  expect(await menu(page, "view.pageView")).toBe(false); // greyed out
  await page.setViewportSize({ width: 1280, height: 800 });
  await expect(toggle(page)).toHaveAttribute("aria-pressed", "true");
  await expect(zoom(page)).toBeVisible();
});
