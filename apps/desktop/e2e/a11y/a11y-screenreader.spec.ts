import type { Page } from "@playwright/test";
import { expect, test } from "../support/coverage";
import { fakeTauri } from "../support/fakeTauri";
import { newProject } from "../support/helpers";
import { virtualScreenReaderScript } from "../support/virtualScreenReader";

/**
 * A virtual screen reader (@guidepup/virtual-screen-reader) walks a container and records what it would announce. It is
 * a simulation of the accessibility tree, not VoiceOver or NVDA (docs/platform-checks.md has those passes), but it
 * reads names, roles and states the way ACCNAME and the ARIA specs say, which catches unnamed controls and bad structure.
 */
async function spoken(page: Page, container: string, stopAt: RegExp, max = 300): Promise<string[]> {
  await page.evaluate(() =>
    Promise.all(document.getAnimations().map((a) => a.finished.catch(() => {}))),
  );
  await page.addScriptTag({ content: await virtualScreenReaderScript() });
  return page.evaluate(
    async ({ container, stop, max }) => {
      const vsr = (
        window as unknown as {
          __vsr: {
            start: (o: { container: Element | null }) => Promise<void>;
            next: () => Promise<void>;
            lastSpokenPhrase: () => Promise<string>;
            stop: () => Promise<void>;
          };
        }
      ).__vsr;
      await vsr.start({ container: document.querySelector(container) });
      const seen: string[] = [];
      for (let i = 0; i < max; i++) {
        await vsr.next();
        const phrase = String(await vsr.lastSpokenPhrase());
        seen.push(phrase);
        if (new RegExp(stop).test(phrase)) break;
      }
      await vsr.stop();
      return seen;
    },
    { container, stop: stopAt.source, max },
  );
}

/** Lines that name a control's role and nothing else: the control has no accessible name. */
const unnamed = (log: string[]) =>
  log.filter(
    (l) =>
      /^(button|combobox|checkbox|textbox|switch|radio|link|slider|spinbutton)(,.*)?$/i.test(
        l.trim(),
      ) && l.trim().split(",").length === 1,
  );

test.beforeEach(async ({ page }) => {
  await fakeTauri(page);
});

test("the Export dialog is read as a dialog, with named controls", async ({ page }) => {
  await newProject(page);
  await page.getByRole("button", { name: "Export", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Export book" })).toBeVisible();
  const log = await spoken(page, "[role=dialog]", /^end of dialog/);
  expect(log.join("\n")).toContain("heading, Export book, level 2");
  expect(log).toContain("radio, Print PDF, not checked, position 2, set size 6");
  expect(log).toContain("button, Export");
  expect(unnamed(log)).toEqual([]);
});

test("the editor toolbar is read as a toolbar of named buttons", async ({ page }) => {
  await newProject(page);
  const log = await spoken(page, "[role=toolbar]", /^end of toolbar/);
  expect(log.filter((l) => l.startsWith("button")).length).toBeGreaterThan(8);
  // The overflow button says it opens a menu.
  expect(log.some((l) => l.includes("More formatting") && l.includes("menu"))).toBe(true);
  expect(unnamed(log)).toEqual([]);
});

test("Settings is read in named sections with labelled fields", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Settings" }).click();
  await expect(page.getByRole("heading", { name: "Settings", level: 1 })).toBeVisible();
  const log = await spoken(page, "main", /^end of main/, 600);
  expect(log.join("\n")).toContain("heading, Appearance, level 2");
  expect(log.some((l) => l.startsWith("switch, "))).toBe(true);
  expect(unnamed(log)).toEqual([]);
});
