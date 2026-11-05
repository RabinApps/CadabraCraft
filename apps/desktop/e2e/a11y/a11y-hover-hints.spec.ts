import { expect, test } from "../support/coverage";
import { fakeTauri } from "../support/fakeTauri";
import { screens } from "../support/a11yScreens";
import { newProject } from "../support/helpers";

// WCAG 1.4.13 (content on hover or focus): a native `title` tooltip cannot be reached from the keyboard, cannot be
// hovered or dismissed, and is not shown on touch. Hints go through ui/Tooltip (focus and hover, Esc, hoverable) or
// are real text (sr-only text, aria-describedby). So no interactive element carries a `title` attribute.

/** Interactive elements that may keep a `title` (none today). Raise only with a written reason. */
const ALLOWED_TITLES = 0;

test.beforeEach(async ({ page }) => {
  await fakeTauri(page);
});

for (const { name, open } of screens) {
  test(`hover hints (1.4.13): no title-only hint on ${name}`, async ({ page }) => {
    await open(page);
    const titled = await page.evaluate(() => {
      const interactive =
        "button, a[href], input, select, textarea, summary, [role], [tabindex], [contenteditable=true]";
      const out = new Set<string>();
      for (const el of document.querySelectorAll<HTMLElement>("[title]")) {
        if (el instanceof SVGElement || el.matches("iframe, abbr, svg *")) continue;
        if (!el.matches(interactive)) continue;
        out.add(`${el.tagName.toLowerCase()} "${el.getAttribute("title")}"`);
      }
      return [...out];
    });
    expect(titled.length, titled.join("\n")).toBeLessThanOrEqual(ALLOWED_TITLES);
  });
}

test("tooltip: an icon button shows its label on focus, Esc closes it, and the name stays", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Settings" }).focus();
  await page.keyboard.press("Tab");
  await page.keyboard.press("Shift+Tab");
  const tip = page.getByRole("tooltip");
  await expect(tip).toBeVisible();
  await expect(tip).toHaveText("Settings");
  await page.keyboard.press("Escape");
  await expect(tip).toBeHidden();
  await expect(page.getByRole("button", { name: "Settings" })).toHaveAttribute(
    "aria-label",
    "Settings",
  );
});

test("tooltip: it stays open while the pointer is over it", async ({ page }) => {
  await page.goto("/");
  const button = page.getByRole("button", { name: "Settings" });
  await button.hover();
  const tip = page.locator("[data-radix-popper-content-wrapper]");
  await expect(tip).toBeVisible();
  await tip.hover();
  await page.waitForTimeout(400);
  await expect(tip).toBeVisible();
});

test("tooltip: a dialog that focuses its first icon button on opening shows no tooltip, so one Escape closes it", async ({
  page,
}) => {
  await newProject(page);
  const opener = page.getByRole("button", { name: "Book details" }).first();
  await opener.focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: "Book details" });
  await expect(dialog).toBeVisible();
  await expect(page.getByRole("tooltip")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
});
