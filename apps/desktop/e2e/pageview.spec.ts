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
  // Read mode draws the pages itself (see reading.spec.ts), with its own zoom from the reading settings.
  await expect(page.locator(".page").first()).toBeVisible();
  await page.getByRole("radio", { name: "Write" }).click();
  await expect(toggle(page)).toHaveAttribute("aria-pressed", "true");
  await expect(zoom(page)).toBeVisible();
});

test("Read mode draws pages whether or not Page view is on in Write mode", async ({ page }) => {
  await newProject(page);
  await expect(toggle(page)).toHaveAttribute("aria-pressed", "false");
  await page.getByRole("radio", { name: "Read" }).click();
  await expect(page.locator(".page").first()).toBeVisible();
  await expect(page.locator(".prose-reading")).toHaveCount(0);
  await page.getByRole("radio", { name: "Write" }).click();
  await expect(toggle(page)).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator(".page")).toHaveCount(0);
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

// Chapter opening (novel: ornament above the title, drop cap on the first paragraph). The pseudo-elements fill the space
// `--page-chapter-extra` reserves, so the title keeps its place and the first paragraph keeps at least three lines of height.
test("a novel chapter draws its ornament and a drop cap in Page view, and not in the normal editor", async ({
  page,
}) => {
  await newProject(page);
  await page.evaluate(() => {
    window.__disk["manuscript/001-chapter-one.json"] = JSON.stringify({
      type: "doc",
      content: [
        { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "Chapter One" }] },
        { type: "paragraph", content: [{ type: "text", text: "Short opening." }] },
      ],
    });
    sessionStorage.setItem("disk", JSON.stringify(window.__disk));
  });
  await page.reload();
  await page.getByRole("button", { name: "Open folder" }).click();
  await expect(page.locator(".ProseMirror h1")).toHaveText("Chapter One");
  const style = () =>
    page.evaluate(() => {
      const h1 = document.querySelector(".ProseMirror h1")!;
      const p = h1.nextElementSibling!;
      const orn = getComputedStyle(h1, "::before");
      return {
        ornament: orn.content,
        ornamentPos: orn.position,
        ornamentTop: parseFloat(orn.top),
        label: getComputedStyle(h1, "::after").content,
        capFloat: getComputedStyle(p, "::first-letter").float,
        paraH: p.getBoundingClientRect().height,
        linePitch: parseFloat(getComputedStyle(p).lineHeight),
        extra: parseFloat(
          getComputedStyle(h1.closest(".page-stack") ?? document.body).getPropertyValue(
            "--page-chapter-extra",
          ),
        ),
      };
    });
  await toggle(page).click();
  await zoom(page).selectOption({ label: "100%" });
  await expect(page.locator(".page").first()).toBeVisible();
  const on = await style();
  expect(on.ornament).toContain("⁂");
  expect(on.ornamentPos).toBe("absolute");
  expect(on.label).toBe("none"); // the novel has no chapter label
  expect(on.capFloat).toBe("left");
  expect(on.paraH).toBeGreaterThanOrEqual(3 * on.linePitch - 1); // a one-line paragraph still holds the cap
  expect(-on.ornamentTop).toBeCloseTo(on.extra, 0); // drawn inside the reserved space
  await toggle(page).click();
  const off = await style();
  expect(off.ornament).not.toContain("⁂");
  expect(off.capFloat).toBe("none");
});
