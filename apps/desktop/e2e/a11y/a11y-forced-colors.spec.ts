import AxeBuilder from "@axe-core/playwright";
import type { Locator, Page } from "@playwright/test";
import { expect, test } from "../support/coverage";
import { fakeTauri } from "../support/fakeTauri";
import { newProject, SHIFT_TAB, TAB } from "../support/helpers";
import { hasEdge, LOOK, ratio, type Look } from "../support/modes";

// Windows High Contrast (forced-colors) and "increase contrast" are emulated by Chromium. Computed styles are compared
// instead of screenshots: a state that depends on a soft fill has to carry a border or outline too, and the states must
// differ from each other. A real Windows pass is still needed (docs/platform-checks.md, "Accessibility passes").

const MEDIA = {
  forced: { forcedColors: "active" },
  contrast: { contrast: "more" },
} as const;

/** The look once the color transitions have finished. */
const look = async (l: Locator): Promise<Look> => {
  await settle(l.page());
  return l.evaluate(LOOK);
};

/** Two states can be told apart without color when the shapes (outline, border, weight) or the colors differ. */
const differs = (a: Look, b: Look) =>
  a.outline !== b.outline ||
  a.border !== b.border ||
  a.outlineWidth !== b.outlineWidth ||
  a.borderWidth !== b.borderWidth ||
  a.weight !== b.weight ||
  a.opacity !== b.opacity ||
  a.color !== b.color ||
  a.background !== b.background;

const settle = (page: Page) =>
  page.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished.catch(() => {}))));

test.beforeEach(async ({ page }) => {
  await fakeTauri(page);
});

for (const scheme of ["light", "dark"] as const) {
  for (const mode of ["forced", "contrast"] as const) {
    test.describe(`${mode === "forced" ? "forced colors" : "increased contrast"}, ${scheme}`, () => {
      test.beforeEach(async ({ page }) => {
        await page.emulateMedia({ colorScheme: scheme, ...MEDIA[mode] });
        await page.addInitScript((th) => {
          document.documentElement.dataset.theme = th;
        }, scheme);
      });

      const toolbar = (page: Page, name: string) =>
        page
          .getByRole("toolbar", { name: "Formatting" })
          .getByRole("button", { name, exact: true });

      test("the selected chapter row differs from the others by shape, not only by fill", async ({
        page,
      }) => {
        await newProject(page);
        await page.getByRole("button", { name: "Add chapter" }).click();
        await expect(page.locator(".ProseMirror h1")).toHaveText("Chapter 2");
        const nav = page.getByRole("navigation", { name: "Chapters" });
        const rows = nav.locator("li");
        const selected = rows.filter({ has: page.locator("button[aria-current='true']") });
        const other = rows.filter({ hasNot: page.locator("button[aria-current='true']") }).first();
        const [rowOn, rowOff] = [await look(selected), await look(other)];
        const [btnOn, btnOff] = [
          await look(selected.locator("button[aria-current]")),
          await look(other.getByRole("button").first()),
        ];
        expect(hasEdge(rowOn) || hasEdge(btnOn), "selected row has an outline or border").toBe(
          true,
        );
        expect(differs(rowOn, rowOff) || differs(btnOn, btnOff)).toBe(true);
        // The part that survives forced colors: a border or outline the unselected row does not have.
        expect(
          rowOn.outlineWidth + rowOn.borderWidth + btnOn.outlineWidth + btnOn.borderWidth,
        ).toBeGreaterThan(
          rowOff.outlineWidth + rowOff.borderWidth + btnOff.outlineWidth + btnOff.borderWidth,
        );
      });

      test("a pressed toolbar toggle differs from an unpressed one", async ({ page }) => {
        await newProject(page);
        await page.locator(".ProseMirror p").last().click();
        await toolbar(page, "Bold").click();
        await expect(toolbar(page, "Bold")).toHaveAttribute("aria-pressed", "true");
        const [on, off] = [await look(toolbar(page, "Bold")), await look(toolbar(page, "Italic"))];
        expect(hasEdge(on)).toBe(true);
        expect(on.outlineWidth + on.borderWidth).toBeGreaterThan(
          off.outlineWidth + off.borderWidth,
        );
      });

      test("the write and read switch shows which one is on", async ({ page }) => {
        await newProject(page);
        const group = page.getByRole("radiogroup", { name: "Write or read" });
        const [on, off] = [
          await look(group.getByRole("radio", { checked: true })),
          await look(group.getByRole("radio", { checked: false })),
        ];
        expect(hasEdge(on)).toBe(true);
        expect(on.outlineWidth + on.borderWidth).toBeGreaterThan(
          off.outlineWidth + off.borderWidth,
        );
      });

      test("the keyboard focus ring is a solid, visible outline", async ({ page, browserName }) => {
        await newProject(page);
        await page.getByRole("button", { name: "Add chapter" }).focus();
        await page.keyboard.press(SHIFT_TAB);
        await page.keyboard.press(TAB);
        const focused = page.locator(":focus");
        await expect(focused).toHaveAccessibleName("Add chapter");
        const f = await look(focused);
        expect(f.outline, "focus-visible outline").toBe(true);
        expect(f.outlineWidth).toBeGreaterThanOrEqual(2);
        // Not the same color as the page behind it.
        const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
        // Playwright's WebKit only flips the forced-colors media query and keeps the page colors, so there is no system
        // outline color to measure in it; the increased-contrast runs still check the ratio there.
        if (mode === "contrast" || browserName !== "webkit")
          expect(ratio(f.outlineColor, bg)).toBeGreaterThanOrEqual(3);
      });

      test("badges and check rows keep an edge and their text", async ({ page }) => {
        await newProject(page);
        const saved = page.getByRole("banner").getByText("Saved", { exact: true });
        const b = await look(saved);
        expect(hasEdge(b), "Saved badge edge").toBe(true);
        expect(await saved.textContent()).toBe("Saved");
        await page.getByRole("button", { name: "Export", exact: true }).click();
        const dialog = page.getByRole("dialog", { name: "Export book" });
        await dialog.getByRole("radio", { name: "Print PDF" }).click();
        await settle(page);
        const rows = dialog.getByRole("list").locator("li[class*='bg-']");
        const n = await rows.count();
        expect(n).toBeGreaterThan(0);
        for (let i = 0; i < n; i++) expect(hasEdge(await look(rows.nth(i)))).toBe(true);
      });

      test("checkboxes stay native and their label stays readable", async ({ page }) => {
        await newProject(page);
        await page.getByRole("button", { name: "Export", exact: true }).click();
        const dialog = page.getByRole("dialog", { name: "Export book" });
        await dialog.getByRole("radio", { name: "Print PDF" }).click();
        const box = dialog.getByRole("checkbox", { name: "PDF/UA (accessible)" });
        const before = await box.isChecked();
        await page.keyboard.press(TAB); // keyboard modality: focus() then shows the focus ring (WebKit ignores a bare modifier key)
        await box.focus();
        // The browser draws a native checkbox in system colors; our CSS must not turn that off.
        expect((await look(box)).forcedColorAdjust).not.toBe("none");
        expect(await box.evaluate((el) => getComputedStyle(el).appearance)).toBe("auto");
        const f = await look(box);
        expect(f.outline, "focused checkbox outline").toBe(true);
        await page.keyboard.press("Space");
        expect(await box.isChecked()).toBe(!before);
        const label = dialog.locator(`label[for="${await box.getAttribute("id")}"]`);
        const l = await look(label);
        expect(
          ratio(l.color, await dialog.evaluate((d) => getComputedStyle(d).backgroundColor)),
        ).toBeGreaterThanOrEqual(4.5);
      });

      test("disabled controls look different from enabled ones", async ({ page }) => {
        await newProject(page);
        // Nothing to undo in a fresh chapter: Undo is disabled, Bold is not.
        const undo = toolbar(page, "Undo");
        await expect(undo).toBeDisabled();
        const [off, on] = [await look(undo), await look(toolbar(page, "Bold"))];
        expect(differs(off, on), "disabled vs enabled").toBe(true);
        // In forced colors the browser paints GrayText; with more contrast the dimming stays.
        if (mode === "contrast") expect(Number(off.opacity)).toBeLessThan(1);
        const disabledPrimary = await page.evaluate(() => {
          const b = document.createElement("button");
          b.disabled = true;
          document.body.append(b);
          const c = getComputedStyle(b).color;
          b.remove();
          return c;
        });
        expect(disabledPrimary).toBeTruthy();
      });

      test("dialogs and their fields have a visible edge", async ({ page }) => {
        await page.goto("/");
        await page.getByRole("button", { name: "New project" }).click();
        const dialog = page.getByRole("dialog", { name: "New book" });
        await settle(page);
        const d = await look(dialog);
        expect(d.border, "dialog border").toBe(true);
        expect(d.borderWidth).toBeGreaterThanOrEqual(1);
        const field = await look(dialog.getByLabel("Title"));
        expect(field.border, "field border").toBe(true);
        const bg = await dialog.evaluate((el) => getComputedStyle(el).backgroundColor);
        if (mode === "contrast") {
          // Increase contrast promotes the hairline border to the 3:1 border color.
          expect(ratio(d.borderColor, bg)).toBeGreaterThanOrEqual(3);
          expect(ratio(field.borderColor, bg)).toBeGreaterThanOrEqual(3);
        } else {
          // Forced colors: CanvasText on Canvas.
          expect(d.borderColor).not.toBe(bg);
        }
      });

      test("menus, the find bar and the history list keep an edge and a current marker", async ({
        page,
      }) => {
        await newProject(page);
        await page.getByRole("button", { name: "Actions for Chapter One" }).click();
        const menu = page.getByRole("menu");
        await settle(page);
        expect(hasEdge(await look(menu)), "menu edge").toBe(true);
        await page.keyboard.press("Escape");
        await page.locator(".ProseMirror").click();
        await page.keyboard.press("ControlOrMeta+f");
        const find = page.getByRole("search", { name: "Find and replace" });
        await expect(find).toBeVisible();
        expect(hasEdge(await look(find)), "find bar edge").toBe(true);
        const chip = find.getByRole("button", { name: "Match case" });
        const off = await look(chip);
        await chip.click();
        const on = await look(chip);
        expect(hasEdge(on)).toBe(true);
        expect(on.outlineWidth + on.borderWidth).toBeGreaterThanOrEqual(
          off.outlineWidth + off.borderWidth,
        );
        expect(differs(on, off), "Match case on vs off").toBe(true);
      });

      test("axe finds no violations", async ({ page }) => {
        await newProject(page);
        await settle(page);
        // Color contrast is decided by the system palette in forced colors, which axe cannot compute.
        const builder = new AxeBuilder({ page }).withTags([
          "wcag2a",
          "wcag2aa",
          "wcag21aa",
          "wcag22aa",
        ]);
        if (mode === "forced") builder.disableRules(["color-contrast"]);
        const { violations } = await builder.analyze();
        expect(
          violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(" | ")}`),
        ).toEqual([]);
        await page.getByRole("button", { name: "Export", exact: true }).click();
        await settle(page);
        const dialogScan = new AxeBuilder({ page }).withTags([
          "wcag2a",
          "wcag2aa",
          "wcag21aa",
          "wcag22aa",
        ]);
        if (mode === "forced") dialogScan.disableRules(["color-contrast"]);
        const again = await dialogScan.analyze();
        expect(
          again.violations.map(
            (v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(" | ")}`,
          ),
        ).toEqual([]);
      });
    });
  }
}

test("settings navigation marks the section being read in forced colors", async ({ page }) => {
  await page.emulateMedia({ forcedColors: "active" });
  await page.goto("/");
  await page.getByRole("button", { name: "Settings" }).click();
  const nav = page.getByRole("navigation", { name: "Settings sections" });
  const on = await look(nav.locator("[aria-current='location']"));
  const off = await look(nav.locator("button:not([aria-current])").first());
  expect(on.outlineWidth + on.borderWidth).toBeGreaterThan(off.outlineWidth + off.borderWidth);
});
