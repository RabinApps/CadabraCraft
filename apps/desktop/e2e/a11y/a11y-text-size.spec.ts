import type { Page } from "@playwright/test";
import { expect, test } from "../support/coverage";
import { fakeTauri } from "../support/fakeTauri";
import { screens } from "../support/a11yScreens";
import { newProject } from "../support/helpers";

// WCAG 1.4.4 (resize text) is only as good as the starting size: interface text is never drawn below 12 px.
// Book content (the manuscript, the page preview, a PDF canvas) follows the author's own size and is not audited.

const MIN_PX = 12;

test.beforeEach(async ({ page }) => {
  await fakeTauri(page);
});

/** Visible interface text drawn smaller than 12 px, as "tag.classes size text". */
async function smallText(page: Page): Promise<string[]> {
  return page.evaluate((min) => {
    const out = new Set<string>();
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const text = n.textContent?.trim();
      const el = n.parentElement;
      if (!text || !el) continue;
      if (
        el.closest(
          ".sr-only, .ProseMirror, .prose-page, .prose-manuscript, canvas, svg, script, style",
        )
      )
        continue;
      if (el.closest("[aria-hidden=true], [inert]")) continue;
      const s = getComputedStyle(el);
      if (s.display === "none" || s.visibility === "hidden") continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      const size = parseFloat(s.fontSize);
      if (size < min)
        out.add(
          `${el.tagName.toLowerCase()}.${String(el.className).slice(0, 50)} ${size}px "${text.slice(0, 24)}"`,
        );
    }
    return [...out];
  }, MIN_PX);
}

/** Text cut off by a fixed-size, overflow-hidden box (no ellipsis), as "tag.classes text". */
async function clipped(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const out: string[] = [];
    for (const el of document.querySelectorAll<HTMLElement>("body *")) {
      if (!el.offsetParent && getComputedStyle(el).position !== "fixed") continue;
      const s = getComputedStyle(el);
      const hides = [s.overflowX, s.overflowY].some((o) => o === "hidden" || o === "clip");
      if (!hides || s.textOverflow === "ellipsis") continue;
      if (!el.textContent?.trim() || el.matches(".sr-only")) continue;
      if (el.scrollHeight > el.clientHeight + 1 || el.scrollWidth > el.clientWidth + 1)
        out.push(
          `${el.tagName.toLowerCase()}.${String(el.className).slice(0, 60)} "${el.textContent.trim().slice(0, 30)}"`,
        );
    }
    return out;
  });
}

for (const { name, open } of screens) {
  test(`text size (1.4.4): no interface text under ${MIN_PX}px on ${name}`, async ({ page }) => {
    await open(page);
    expect(await smallText(page)).toEqual([]);
  });
}

// Longer words (German) and other scripts (Hebrew, Arabic) must not clip the small uppercase headings or menu labels.
for (const code of ["de", "he", "ar"]) {
  test(`text size: menus and headings do not clip in ${code}`, async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Settings" }).click();
    await page.getByLabel("Interface language").selectOption(code);
    await page.goBack().catch(() => undefined);
    await page.goto("/");
    await newProject(page);
    expect(await smallText(page)).toEqual([]);
    expect(await clipped(page)).toEqual([]);
    await page.locator("button[aria-haspopup=menu]").first().click();
    expect(await smallText(page)).toEqual([]);
    expect(await clipped(page)).toEqual([]);
  });
}
