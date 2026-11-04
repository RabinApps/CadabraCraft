import type { Page } from "@playwright/test";
import { expect, test } from "./support/coverage";
import { fakeTauri } from "./support/fakeTauri";
import { screens } from "./support/a11yScreens";
import { clippedText, TAB } from "./support/helpers";
import { hasEdge, LOOK } from "./support/modes";

// Windows High Contrast (forced colors) and "increase contrast" over every screen of a11yScreens.ts (a11y-forced-colors.spec.ts
// covers a few states in depth): the focus ring is there, a selected or pressed control differs from the others by more than
// colour, the pages of the book stay readable text on their background and nothing is cut off. A real Windows pass is
// still needed (docs/platform-checks.md, "Accessibility passes").

const MEDIA = {
  forced: { forcedColors: "active" },
  contrast: { contrast: "more" },
} as const;

const settle = (page: Page) =>
  page.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished.catch(() => {}))));

/** Controls that say "on" through an ARIA state (a native checkbox or radio is drawn by the system and is left out). */
const STATE =
  "[aria-pressed=true], [aria-checked=true], [aria-selected=true], [aria-current]:not([aria-current=false]), [data-state=on], [data-state=checked]";

test.beforeEach(async ({ page }) => {
  await fakeTauri(page);
});

for (const [mode, schemes] of [
  ["forced", ["light"]],
  ["contrast", ["light", "dark"]],
] as const) {
  for (const scheme of schemes) {
    test.describe(`${mode === "forced" ? "forced colors" : "increased contrast"}, ${scheme}`, () => {
      test.beforeEach(async ({ page }) => {
        await page.emulateMedia({ colorScheme: scheme, ...MEDIA[mode] });
        await page.addInitScript((th) => {
          document.documentElement.dataset.theme = th;
        }, scheme);
      });

      for (const { name, open } of screens) {
        test(`${name}: focus ring, states, pages and text`, async ({ page }) => {
          await open(page);
          await settle(page);

          // 1. The first Tab (or the one that gets the dialog's field) lands on something with a visible outline.
          // In an open menu the focus starts on the menu itself; the arrow key puts it on the first item.
          await page.keyboard.press((await page.getByRole("menu").count()) > 0 ? "ArrowDown" : TAB);
          const focused = page.locator(":focus");
          if (
            (await focused.count()) === 1 &&
            (await focused.evaluate((e) => e !== document.body))
          ) {
            const f = await focused.evaluate(LOOK);
            expect(f.outline, "the focused control has an outline").toBe(true);
            expect(f.outlineWidth).toBeGreaterThanOrEqual(2);
          }

          // 2. Every control that is on, selected or current has an edge (outline or border) that survives the mode.
          const noEdge: string[] = [];
          for (const el of await page.locator(STATE).all()) {
            if (!(await el.isVisible())) continue;
            const skip = await el.evaluate(
              (e) =>
                !!e.closest("[aria-hidden=true], [inert]") ||
                e.matches("input[type=checkbox], input[type=radio]"),
            );
            if (skip) continue;
            if (!hasEdge(await el.evaluate(LOOK)))
              noEdge.push(
                await el.evaluate(
                  (e) =>
                    `${e.tagName.toLowerCase()} "${(e.getAttribute("aria-label") ?? e.textContent ?? "").trim().slice(0, 30)}"`,
                ),
              );
          }
          expect(noEdge, "on / selected / current controls without an outline or border").toEqual(
            [],
          );

          // 3. The pages of the book (page cards, print preview, contents preview) are text on a background, in every mode.
          const bad = await page.evaluate(() => {
            const parse = (c: string) => (c.match(/[\d.]+/g) ?? []).map(Number);
            const lum = (c: string) => {
              const [r, g, b] = parse(c)
                .slice(0, 3)
                .map((v) => {
                  const x = v / 255;
                  return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
                });
              return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
            };
            /** The first opaque background up the tree, else white (the canvas). */
            const backdrop = (el: Element): string => {
              for (let e: Element | null = el; e; e = e.parentElement) {
                const c = getComputedStyle(e).backgroundColor;
                if ((parse(c)[3] ?? 1) > 0.5) return c;
              }
              return "rgb(255, 255, 255)";
            };
            const out: string[] = [];
            const pages = document.querySelectorAll(
              ".page-card, .prose-page, [data-testid='toc-preview-page'], canvas",
            );
            for (const pg of pages) {
              if (pg.matches("canvas")) continue; // a bitmap of the PDF: its colours are the book's, not the interface's
              for (const el of pg.querySelectorAll<HTMLElement>("p, h1, h2, h3, li, span, div")) {
                if (
                  !el.childNodes.length ||
                  ![...el.childNodes].some((n) => n.nodeType === 3 && n.textContent?.trim())
                )
                  continue;
                const r = el.getBoundingClientRect();
                if (r.width === 0 || r.height === 0) continue;
                const fg = getComputedStyle(el).color;
                const bg = backdrop(el);
                const [hi, lo] = [lum(fg), lum(bg)].sort((x, y) => y - x);
                if ((hi! + 0.05) / (lo! + 0.05) < 4.5)
                  out.push(
                    `${el.tagName.toLowerCase()} "${el.textContent!.trim().slice(0, 20)}" ${fg} on ${bg}`,
                  );
              }
            }
            return out.slice(0, 5);
          });
          expect(bad, "page text with less than 4.5:1 against its background").toEqual([]);

          // 4. Nothing is cut off that was not already cut off with the mode switched off.
          const inMode = await clippedText(page);
          await page.emulateMedia({ forcedColors: "none", contrast: "no-preference" });
          const normal = await clippedText(page);
          expect(inMode.filter((c) => !normal.includes(c))).toEqual([]);
        });
      }
    });
  }
}
