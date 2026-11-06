import type { Page } from "@playwright/test";
import { expect, test } from "../support/coverage";
import { fakeTauri } from "../support/fakeTauri";
import { screens } from "../support/a11yScreens";
import { audit } from "../support/audit";
import { chapterDoc, focusEnd, newProject, seedChapters, SHIFT_TAB, TAB } from "../support/helpers";
import { MAIN, sources } from "../support/a11yWcagExtra";

test.beforeEach(async ({ page }) => {
  await fakeTauri(page);
});

// ---------------------------------------------------------------------------------------------------------------------------
// 1.4.13 Content on Hover or Focus

test.describe("1.4.13 content on hover or focus", () => {
  test("the app builds no tooltip or popover that shows on hover or focus, except the print preview's Edit this page hint", async () => {
    const hits = sources()
      .filter(
        ({ file, text }) =>
          // TypstSpread is the print preview's hint (tested below); Toolbar's onFocus only tracks which button the arrow keys start from.
          // ui/Dialog.tsx's onFocus scrolls the focused control into view. ui/Tooltip.tsx is the one tooltip (Radix: hover and focus,
          // Esc, hoverable; tested in a11y-hover-hints.spec.ts) and ui/Button.tsx is its only user.
          !/TypstSpread|editor\/Toolbar\.tsx$|ui\/Dialog\.tsx$|ui\/Tooltip\.tsx$|ui\/Button\.tsx$/.test(
            file,
          ) &&
          /group-hover:(?:block|visible|opacity-100|flex)|group-focus[\w-]*:(?:block|visible|opacity-100|flex)|peer-hover|role="tooltip"|<Tooltip|<Popover|HoverCard|onMouseEnter|onPointerEnter|onMouseOver|onFocus=\{/.test(
            text,
          ),
      )
      .map((s) => s.file);
    expect(hits).toEqual([]);
  });

  for (const { name, open } of MAIN) {
    test(`hovering or focusing any control on ${name} adds no content`, async ({ page }) => {
      test.setTimeout(180_000);
      await open(page);
      const SEL =
        "button, a[href]:not([href^='#']), select, input:not([type=hidden]), [role=radio], [role=switch], [role=menuitem], [role=tab]";
      // Behind a dialog only the dialog can be reached; the "Saved" notice of a new book also arrives a moment after it opens.
      const dialog = page.locator("[role=dialog]").last();
      const scope = (await dialog.count()) > 0 ? dialog : page.locator("body");
      await page.waitForTimeout(600);
      const count = Math.min(await scope.locator(SEL).count(), 24);
      // Let the dialog's own open animation finish, so only what hover and focus add is counted.
      await page.evaluate(() =>
        Promise.all(document.getAnimations().map((a) => a.finished.catch(() => {}))),
      );
      // Anything hover or focus adds is a new element (a tooltip, a popover, a hint); the elements already there only restyle.
      const snapshot = () =>
        page.evaluate(() => ({
          // The shared Tooltip (a Radix popper portal) is the one thing hover and focus may add; it is audited in a11y-hover-hints.spec.ts.
          count: [...document.body.getElementsByTagName("*")].filter(
            (e) => !e.closest("[data-radix-popper-content-wrapper]"),
          ).length,
          tooltips: document.querySelectorAll("[popover]:popover-open").length,
        }));
      const bad: string[] = [];
      for (let i = 0; i < count; i++) {
        const el = scope.locator(SEL).nth(i);
        if (!(await el.isVisible())) continue;
        const before = await snapshot();
        await el.hover({ timeout: 2000 }).catch(() => {});
        await page.waitForTimeout(20);
        const hovered = await snapshot();
        await el.focus().catch(() => {});
        const focused = await snapshot();
        await page.mouse.move(0, 0);
        if (hovered.count !== before.count || hovered.tooltips)
          bad.push(`hover ${i}: ${before.count}->${hovered.count}`);
        if (focused.count !== before.count || focused.tooltips)
          bad.push(`focus ${i}: ${before.count}->${focused.count}`);
      }
      expect(bad).toEqual([]);
    });
  }

  test("print preview: the Edit this page hint shows on hover and keyboard focus and is not hidden by moving into it", async ({
    page,
  }) => {
    const preview = screens.find((s) => s.name === "print preview")!;
    await preview.open(page);
    const open = page.getByRole("button", { name: /^Open page \d+ in the editor$/ }).first();
    await open.waitFor({ state: "visible", timeout: 15_000 }).catch(() => {});
    test.skip((await open.count()) === 0, "the fake PDF has no pages to open in this build");
    const hint = open.locator("span").first();
    await open.hover();
    await expect(hint).toHaveCSS("opacity", "1");
    // Dismissible: Escape hides the hint without moving the pointer.
    await page.keyboard.press("Escape");
    await expect(hint).toHaveCSS("opacity", "0");
    // It comes back the next time the pointer or focus arrives, and the same goes for keyboard focus.
    await page.mouse.move(0, 0);
    await expect(hint).toHaveCSS("opacity", "0");
    await open.focus();
    await expect(hint).toHaveCSS("opacity", "1");
    await page.keyboard.press("Escape");
    await expect(hint).toHaveCSS("opacity", "0");
    await page.evaluate(() => (document.activeElement as HTMLElement).blur());
    await open.focus();
    await expect(hint).toHaveCSS("opacity", "1");
  });
});

// ---------------------------------------------------------------------------------------------------------------------------
// 2.4.11 Focus Not Obscured

/** Is the focused element at least partly visible, that is not entirely hidden by another element? */
const hiddenFocus = (page: Page) =>
  page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    if (!el || el === document.body || el === document.documentElement) return null;
    const desc = (e: Element | null) =>
      e ? `${e.tagName.toLowerCase()}.${String(e.className).slice(0, 50)}` : "nothing";
    // Custom checkboxes and switches hide the real input and show a label or a sibling.
    const tiny = el.getBoundingClientRect();
    const box =
      tiny.width < 4 || tiny.height < 4 || el.matches(".sr-only")
        ? (el.closest("label") ?? (el as HTMLInputElement).labels?.[0] ?? el.parentElement ?? el)
        : el;
    const r = box.getBoundingClientRect();
    const vw = document.documentElement.clientWidth;
    const vh = window.innerHeight;
    const x0 = Math.max(r.left, 0);
    const x1 = Math.min(r.right, vw);
    const y0 = Math.max(r.top, 0);
    const y1 = Math.min(r.bottom, vh);
    if (x1 - x0 < 1 || y1 - y0 < 1) return `${desc(el)} is outside the window`;
    const points: [number, number][] = [
      [(x0 + x1) / 2, (y0 + y1) / 2],
      [x0 + 1, y0 + 1],
      [x1 - 1, y0 + 1],
      [x0 + 1, y1 - 1],
      [x1 - 1, y1 - 1],
    ];
    let blocker: Element | null = null;
    for (const [x, y] of points) {
      const top = document.elementFromPoint(x, y);
      if (!top) continue;
      if (box.contains(top) || top.contains(box) || el.contains(top)) return null;
      blocker = top;
    }
    return `${desc(el)} "${(el.getAttribute("aria-label") ?? el.textContent ?? "").trim().slice(0, 30)}" is covered by ${desc(blocker)}`;
  });

/** Like hiddenFocus, but a hit gets 500 ms to be a scroll that is still smoothly on its way (Settings scrolls smoothly in WebKit). */
async function settledHidden(page: Page) {
  const first = await hiddenFocus(page);
  if (!first) return null;
  await page.waitForTimeout(500);
  return hiddenFocus(page);
}

test.describe("2.4.11 focus not obscured", () => {
  // The narrowest window on every screen; the desktop size and 200% zoom on the main ones.
  const SIZES = [
    ["320 x 640", { width: 320, height: 640 }, screens],
    ["1280 x 800", { width: 1280, height: 800 }, MAIN],
    ["640 x 400 (200% zoom)", { width: 640, height: 400 }, MAIN],
  ] as const;
  for (const [label, size, list] of SIZES) {
    for (const { name, open } of list) {
      test(`${name} at ${label}: every focus stop is visible`, async ({ page }) => {
        await open(page);
        await page.setViewportSize(size);
        await page.waitForTimeout(100);
        const bad: string[] = [];
        for (let i = 0; i < 30; i++) {
          await page.keyboard.press(TAB);
          const h = await settledHidden(page);
          if (h) bad.push(h);
        }
        for (let i = 0; i < 10; i++) {
          await page.keyboard.press(SHIFT_TAB);
          const h = await settledHidden(page);
          if (h) bad.push(h);
        }
        expect(bad).toEqual([]);
      });
    }
  }

  for (const size of [
    { width: 1280, height: 800 },
    { width: 320, height: 640 },
  ]) {
    test(`typing at the end of a long chapter keeps the caret clear of the toolbar and status bar at ${size.width}`, async ({
      page,
    }) => {
      await newProject(page);
      await seedChapters(page, [chapterDoc("Long chapter", 60, 60)]);
      await page.setViewportSize(size);
      await focusEnd(page);
      for (let line = 0; line < 12; line++) {
        await page.keyboard.type(`Another line of text ${line}`);
        await page.keyboard.press("Enter");
      }
      await page.keyboard.type("last");
      const covered = await page.evaluate(() => {
        const sel = getSelection();
        const range = sel?.rangeCount ? sel.getRangeAt(0) : null;
        const rect =
          range?.getClientRects()[0] ??
          (range?.startContainer.parentElement ?? document.body).getBoundingClientRect();
        const x = rect.left + 1;
        const y = rect.top + Math.max(rect.height / 2, 1);
        const top = document.elementFromPoint(x, y);
        return top && !top.closest(".ProseMirror")
          ? `${top.tagName}.${String(top.className).slice(0, 60)} at ${Math.round(y)} of ${innerHeight}`
          : null;
      });
      expect(covered).toBeNull();
    });
  }
});

// ---------------------------------------------------------------------------------------------------------------------------
// 1.4.4 Resize Text

test.describe("1.4.4 resize text", () => {
  for (const { name, open } of screens) {
    test(`${name} at 200% zoom (640 x 400 CSS px): no overflow, nothing clipped`, async ({
      page,
    }) => {
      await open(page);
      await page.setViewportSize({ width: 640, height: 400 });
      const issues = (await audit(page)).filter(
        (i) => i.kind === "scroll-x" || i.kind === "clipped",
      );
      expect(issues).toEqual([]);
    });
  }

  // The Contents editor is left out: it shows the list and its preview side by side from 1280 px, and doubling the root font
  // size leaves the preview 70 px wide (a real text-size setting also scales the breakpoints, which this emulation cannot do).
  for (const { name, open } of MAIN.filter((s) => s.name !== "Add custom entry dialog")) {
    test(`${name} with text at 200% (root font size doubled): the page still works`, async ({
      page,
    }) => {
      await open(page);
      const size = () =>
        page.evaluate(() => {
          const el = document.querySelector("h1, h2, label, button, p, span");
          return parseFloat(getComputedStyle(el!).fontSize);
        });
      const before = await size();
      await page.addStyleTag({ content: "html { font-size: 200% !important; }" });
      await page.waitForTimeout(100);
      const after = await size();
      // Text is set in rem, so it follows the browser's text size.
      expect(after).toBeGreaterThan(before * 1.5);
      const clipped = await page.evaluate(() => {
        const out: string[] = [];
        for (const el of document.querySelectorAll<HTMLElement>("body *")) {
          if (!el.offsetParent && getComputedStyle(el).position !== "fixed") continue;
          const s = getComputedStyle(el);
          const cuts = (o: string) => o === "hidden" || o === "clip";
          // An axis that scrolls (auto or scroll) loses nothing; one that is cut off does when the content is larger.
          const lost =
            (cuts(s.overflowX) && el.scrollWidth > el.clientWidth + 1) ||
            (cuts(s.overflowY) && el.scrollHeight > el.clientHeight + 1);
          if (
            !lost ||
            s.textOverflow === "ellipsis" ||
            el.matches(".sr-only") ||
            !el.textContent?.trim()
          )
            continue;
          out.push(`${el.tagName.toLowerCase()} "${el.textContent.trim().slice(0, 30)}"`);
        }
        return out;
      });
      expect(clipped).toEqual([]);
    });
  }
});
