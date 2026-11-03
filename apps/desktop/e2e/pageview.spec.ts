import { expect, test, type Page } from "./support/coverage";
import { fakeTauri } from "./support/fakeTauri";
import { newProject } from "./support/helpers";

// The writing surface is always the formatted book: pages at md+ width, the reflowed page look on a phone. There is no toggle or
// menu command (the dev build exposes what each native menu item runs); this covers the zoom select and the surface by width.

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
const zoom = (page: Page) => page.getByLabel("Page zoom");

test.beforeEach(async ({ page }) => {
  await fakeTauri(page);
});

test("a new book opens on pages, with no Page view button or menu command", async ({ page }) => {
  await newProject(page);
  await expect(page.locator(".page").first()).toBeVisible();
  await expect(zoom(page)).toBeVisible();
  await expect(page.getByRole("button", { name: "Page view", exact: true })).toHaveCount(0);
  expect(await menu(page, "view.pageView")).toBe(false); // no such command any more
});

test("the zoom select offers Fit width, 75%, 100% and 125% and is remembered", async ({ page }) => {
  await newProject(page);
  await expect(zoom(page)).toHaveValue("fit");
  await expect(zoom(page).locator("option")).toHaveText(["Fit width", "75%", "100%", "125%"]);
  await zoom(page).selectOption({ label: "125%" });
  await page.reload();
  await page.getByRole("button", { name: "Open folder" }).click();
  await expect(zoom(page)).toHaveValue("1.25");
  await zoom(page).selectOption({ label: "Fit width" });
  await expect(zoom(page)).toHaveValue("fit");
});

test("Read mode draws its own pages, and Write mode comes back to the page surface", async ({
  page,
}) => {
  await newProject(page);
  await page.getByRole("radio", { name: "Read" }).click();
  await expect(page.locator(".ProseMirror")).toHaveAttribute("contenteditable", "false");
  await expect(zoom(page)).toBeVisible(); // the reading footer has the same zoom select
  await expect(page.locator(".page").first()).toBeVisible();
  await expect(page.locator(".prose-reading")).toHaveCount(0);
  await page.getByRole("radio", { name: "Write" }).click();
  await expect(zoom(page)).toBeVisible();
  await expect(page.locator(".page").first()).toBeVisible();
});

test("a phone gets the reflowed page look: no page cards or zoom, the template's type", async ({
  page,
}) => {
  await newProject(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByTestId("reflow-scroll")).toBeVisible();
  await expect(page.locator(".prose-reflow")).toBeVisible();
  await expect(page.locator(".page")).toHaveCount(0);
  await expect(page.locator(".page-chip")).toHaveCount(0);
  await expect(zoom(page)).toBeHidden();
  // The book's own type: the novel template's serif, justified, with no extra width cap.
  const look = await page.evaluate(() => {
    const el = document.querySelector(".prose-reflow .ProseMirror")!;
    const cs = getComputedStyle(el);
    return { align: cs.textAlign, width: el.getBoundingClientRect().width, font: cs.fontFamily };
  });
  expect(look.align).toBe("justify");
  expect(look.width).toBeGreaterThan(330);
  expect(look.width).toBeLessThanOrEqual(390);
  await page.setViewportSize({ width: 1280, height: 800 });
  await expect(page.locator(".page").first()).toBeVisible();
  await expect(page.locator(".prose-reflow")).toHaveCount(0);
});

// Chapter opening (novel: ornament above the title, drop cap on the first paragraph). The pseudo-elements fill the space
// `--page-chapter-extra` reserves, so the title keeps its place and the first paragraph keeps at least three lines of height.
test("a novel chapter draws its ornament and a drop cap on the page, and keeps them when it reflows", async ({
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
  await zoom(page).selectOption({ label: "100%" });
  await expect(page.locator(".page").first()).toBeVisible();
  const on = await style();
  expect(on.ornament).toContain("⁂");
  expect(on.ornamentPos).toBe("absolute");
  expect(on.label).toBe("none"); // the novel has no chapter label
  expect(on.capFloat).toBe("left");
  expect(on.paraH).toBeGreaterThanOrEqual(3 * on.linePitch - 1); // a one-line paragraph still holds the cap
  expect(-on.ornamentTop).toBeCloseTo(on.extra, 0); // drawn inside the reserved space
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator(".prose-reflow")).toBeVisible();
  const reflowed = await style();
  expect(reflowed.ornament).toContain("⁂");
  expect(reflowed.capFloat).toBe("left");
});
