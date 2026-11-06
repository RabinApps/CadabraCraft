import type { Page } from "@playwright/test";
import { expect, test } from "../support/coverage";
import { fakeTauri } from "../support/fakeTauri";
import { screens } from "../support/a11yScreens";
import { SHIFT_TAB, TAB } from "../support/helpers";
import { fresh, named, MAIN } from "../support/a11yWcagExtra";

test.beforeEach(async ({ page }) => {
  await fakeTauri(page);
});

// ---------------------------------------------------------------------------------------------------------------------------
// 3.2.1 On Focus and 3.2.2 On Input

/** What a person would call "the screen": where they are, what is open on top and what the page is called. */
const context = (page: Page) =>
  page.evaluate(() => ({
    href: location.href,
    title: document.title,
    heading: document.querySelector("h1")?.textContent ?? "",
    dialogs: [...document.querySelectorAll("[role=dialog]")].map(
      (d) => d.getAttribute("aria-label") ?? d.querySelector("h2")?.textContent ?? "",
    ),
    submits: (window as never as { __submits?: number }).__submits ?? 0,
    opened: (window as never as { __opened?: number }).__opened ?? 0,
  }));
const watch = (page: Page) =>
  page.evaluate(() => {
    const w = window as never as { __submits: number; __opened: number };
    w.__submits = 0;
    w.__opened = 0;
    document.addEventListener("submit", () => w.__submits++, true);
    window.open = () => {
      w.__opened++;
      return null;
    };
  });

test.describe("3.2.1 on focus", () => {
  for (const { name, open } of MAIN) {
    test(`tabbing through ${name} never opens, closes or submits anything`, async ({ page }) => {
      await open(page);
      await watch(page);
      const first = await context(page);
      const seen = new Set<string>();
      for (let i = 0; i < 45; i++) {
        await page.keyboard.press(TAB);
        const id = await page.evaluate(() => {
          const el = document.activeElement;
          return el
            ? `${el.tagName}:${el.getAttribute("aria-label") ?? el.textContent?.slice(0, 20)}`
            : "none";
        });
        seen.add(id);
        expect(await context(page), `after focusing ${id}`).toEqual(first);
      }
      for (let i = 0; i < 10; i++) {
        await page.keyboard.press(SHIFT_TAB);
        expect(await context(page)).toEqual(first);
      }
      expect(seen.size).toBeGreaterThan(1);
    });
  }
});

test.describe("3.2.2 on input", () => {
  const CONTROLS =
    "select, input[type=checkbox], input[type=radio], [role=switch], [role=radio], [role=checkbox], input[type=range]";
  /** Controls whose job is to switch what the page shows (a view toggle), reviewed and named in the report. */
  const VIEW_TOGGLES = ["Write", "Read"];

  for (const { name, open } of MAIN) {
    test(`changing a select, checkbox, radio or switch on ${name} keeps the context`, async ({
      page,
    }) => {
      await open(page);
      await watch(page);
      const root = page.locator("[role=dialog]").last();
      const scope = (await root.count()) > 0 ? root : page.locator("body");
      const count = await scope.locator(CONTROLS).count();
      const changed: string[] = [];
      for (let i = 0; i < count; i++) {
        const control = scope.locator(CONTROLS).nth(i);
        if (!(await control.isVisible()) || !(await control.isEnabled())) continue;
        const label =
          (await control.getAttribute("aria-label")) ??
          (await control.evaluate(
            (el) => (el as HTMLInputElement).labels?.[0]?.textContent ?? el.textContent ?? el.id,
          ));
        if (VIEW_TOGGLES.includes(label?.trim() ?? "")) continue;
        const before = await context(page);
        const tag = await control.evaluate((el) => el.tagName);
        if (tag === "SELECT") {
          const values = await control
            .locator("option")
            .evaluateAll((o) => o.map((x) => (x as HTMLOptionElement).value));
          const current = await control.inputValue();
          const next = values.find((v) => v !== current);
          if (next === undefined) continue;
          await control.selectOption(next);
          if (label?.trim() === "Interface language") {
            // A new language changes the page title and heading on purpose, and its catalog loads a moment later: wait until
            // the page has settled in it so the next control is measured against the new language, not caught mid-change.
            await page.waitForFunction(
              (v) => document.documentElement.lang.startsWith(v),
              next.split("-")[0]!,
            );
            await page.waitForTimeout(300);
            continue;
          }
        } else {
          await control.click({ force: true });
        }
        const after = await context(page);
        if (JSON.stringify(after) !== JSON.stringify(before))
          changed.push(`${label?.trim()}: ${JSON.stringify(after)}`);
        // The page must not have moved focus away from the control the person is using.
        if ((await page.locator("[role=dialog]").count()) !== before.dialogs.length) break;
      }
      expect(changed).toEqual([]);
    });
  }

  test("typing in a text field and leaving it does not submit or navigate", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "New project" }).click();
    await watch(page);
    const dialog = page.getByRole("dialog", { name: "New book" });
    const before = await context(page);
    await dialog.getByLabel("Title").fill("A title");
    await page.keyboard.press(TAB);
    await dialog.getByLabel("Author").fill("An author");
    await page.keyboard.press(TAB);
    expect(await context(page)).toEqual(before);
  });
});

// ---------------------------------------------------------------------------------------------------------------------------
// 3.2.3 Consistent Navigation and 3.2.4 Consistent Identification

const SHELL = named("home", "editor", "settings", "Read mode", "Focus mode", "Contents editor");

/** The names of the repeated chrome (header, navigation, banner, skip link), in the order a person meets them. */
const chrome = (page: Page) =>
  page.evaluate(() => {
    const out: string[] = [];
    const nameOf = (el: Element) =>
      (el.getAttribute("aria-label") ?? el.textContent ?? "").replace(/\s+/g, " ").trim();
    const roots = document.querySelectorAll(
      "header, nav, [role=banner], [role=navigation], a.skip-link, a[href^='#']",
    );
    for (const root of roots) {
      const items = root.matches("a, button")
        ? [root]
        : root.querySelectorAll("a[href], button, [role=radio]");
      for (const el of items) {
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) continue;
        const n = nameOf(el);
        if (n && !out.includes(n)) out.push(n);
      }
    }
    return out;
  });

test.describe("3.2.3 consistent navigation", () => {
  test("controls that repeat on several screens keep their relative order", async ({
    browser,
    baseURL,
  }) => {
    const byScreen = new Map<string, string[]>();
    for (const s of SHELL) {
      const page = await fresh(browser, baseURL);
      await s.open(page);
      byScreen.set(s.name, await chrome(page));
      await page.context().close();
    }
    const entries = [...byScreen];
    expect(entries.every(([, names]) => names.length > 0)).toBe(true);
    const bad: string[] = [];
    for (const [a, namesA] of entries)
      for (const [b, namesB] of entries) {
        if (a >= b) continue;
        const common = namesA.filter((n) => namesB.includes(n));
        const inB = namesB.filter((n) => common.includes(n));
        if (JSON.stringify(common) !== JSON.stringify(inB))
          bad.push(`${a} vs ${b}: ${common.join(" | ")}  <>  ${inB.join(" | ")}`);
      }
    expect(bad).toEqual([]);
  });

  test("the skip link is the first stop on every main screen", async ({ browser, baseURL }) => {
    for (const s of SHELL.filter((x) => x.name !== "Focus mode")) {
      const page = await fresh(browser, baseURL);
      await s.open(page);
      const first = await page.evaluate(() => {
        const stops = [
          ...document.querySelectorAll<HTMLElement>(
            "a[href], button, input, select, textarea, [tabindex]",
          ),
        ].filter(
          (el) =>
            el.tabIndex >= 0 &&
            !el.closest("[inert], [hidden]") &&
            !(el as HTMLInputElement).disabled &&
            !el.matches(".ProseMirror *"),
        );
        return stops[0]?.textContent?.trim() ?? "";
      });
      expect(first, s.name).toMatch(/skip/i);
      await page.context().close();
    }
    // And a real Tab press from a fresh load lands on it.
    const page = await fresh(browser, baseURL);
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await page.keyboard.press(TAB);
    await expect(page.getByRole("link", { name: /skip/i })).toBeFocused();
    await page.context().close();
  });
});

test.describe("3.2.4 consistent identification", () => {
  test("the same icon always has the same name", async ({ browser, baseURL }) => {
    test.setTimeout(300_000);
    const byIcon = new Map<string, Map<string, string[]>>();
    for (const s of screens) {
      const page = await fresh(browser, baseURL);
      await s.open(page);
      const found = await page.evaluate(() => {
        const out: [string, string][] = [];
        for (const el of document.querySelectorAll("button, a[href], [role=menuitem]")) {
          const svg = el.querySelector("svg[class*=lucide]");
          if (!svg || (el.textContent ?? "").trim() !== "") continue;
          const icon =
            [...svg.classList].find((c) => /^lucide-[a-z0-9-]+$/.test(c) && c !== "lucide") ?? "";
          const name = (el.getAttribute("aria-label") ?? "").replace(/\s+/g, " ").trim();
          out.push([
            icon,
            // A row's own number or title is not a different function ("Move chapter 1 up", "Move chapter 2 up").
            name
              .replace(/^(Actions for|Reorder|Undo:|Redo:)\s.*$/, "$1")
              .replace(/\bchapter \d+\b/gi, "chapter")
              .trim() || name,
          ]);
        }
        return out;
      });
      for (const [icon, name] of found) {
        const names = byIcon.get(icon) ?? new Map<string, string[]>();
        names.set(name, [...(names.get(name) ?? []), s.name]);
        byIcon.set(icon, names);
      }
      await page.context().close();
    }
    // Icons that stand for different functions in different places, reviewed by hand. The icon is reused, the function is not.
    const REVIEWED: Record<string, string> = {
      "lucide-ellipsis":
        "More actions (header overflow) and Actions for a row (that row's own menu)",
      "lucide-undo-2":
        "Undo (the text, in the formatting toolbar) and Undo book change (the chapter list)",
      "lucide-redo-2": "Redo (the text) and Redo book change (the chapter list)",
      "lucide-search":
        "Command palette (search the app's commands) and Search in PDF (search the text of the open reference)",
      "lucide-x":
        "Close a dialog, Close viewer, Close chapters and Dismiss message all take something away; the name says what",
      "lucide-a-large-small": "Small caps (format) and Reading settings (the Read mode panel)",
      "lucide-chevron-down":
        "Hide scenes of a chapter (the row's disclosure) and Next match (the Find bar): a disclosure and a step",
      "lucide-chevron-right":
        "Show scenes of a chapter (the row's disclosure) and Next chapter / Next page (the reader's steps)",
    };
    const report = [...byIcon]
      .filter(([icon, names]) => icon && names.size > 1 && !(icon in REVIEWED))
      .map(([icon, names]) => `${icon}: ${[...names.keys()].join(" / ")}`);
    expect(report).toEqual([]);
  });
});
