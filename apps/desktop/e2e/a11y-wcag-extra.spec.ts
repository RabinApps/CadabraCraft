import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import type { Browser, Page } from "@playwright/test";
import { expect, test } from "./support/coverage";
import { fakeTauri } from "./support/fakeTauri";
import { screens } from "./support/a11yScreens";
import { audit } from "./support/audit";
import { chapterDoc, focusEnd, newProject, seedChapters, SHIFT_TAB, TAB } from "./support/helpers";

// WCAG 2.2 criteria that axe cannot judge and that the other a11y specs do not cover: 1.3.3, 1.3.5, 1.4.2, 1.4.4, 1.4.13, 2.1.4,
// 2.2.2, 2.3.1, 2.4.2, 2.4.11, 2.5.2, 3.2.1 to 3.2.4 and 3.3.7. What each test proves (and what it cannot) is in the conformance report.

test.beforeEach(async ({ page }) => {
  await fakeTauri(page);
});

/** A page in its own browser context, so one screen's saved view (Focus mode, a stub from another screen) never leaks into the next. */
async function fresh(browser: Browser, baseURL: string | undefined): Promise<Page> {
  const context = await browser.newContext(baseURL ? { baseURL } : {});
  const page = await context.newPage();
  await fakeTauri(page);
  return page;
}

const named = (...names: string[]) => screens.filter((s) => names.includes(s.name));
/** The screens that hold the shell, the forms and the long-lived dialogs. */
const MAIN = named(
  "home",
  "editor",
  "New book dialog",
  "settings",
  "settings, Audio section without voices",
  "export dialog",
  "export dialog, PDF options",
  "Book details dialog",
  "Add language dialog",
  "Add image dialog",
  "Insert table dialog",
  "Language of selection dialog",
  "Add custom entry dialog",
);

/** Every source file of the app that is not a test. */
function sources(dir = path.join(process.cwd(), "src")): { file: string; text: string }[] {
  return readdirSync(dir).flatMap((n) => {
    const f = path.join(dir, n);
    if (n === "__tests__" || n === "node_modules" || n === "test") return [];
    if (statSync(f).isDirectory()) return sources(f);
    return /\.(tsx?|css)$/.test(n) && !/\.test\./.test(n)
      ? [{ file: path.relative(process.cwd(), f), text: readFileSync(f, "utf8") }]
      : [];
  });
}

// ---------------------------------------------------------------------------------------------------------------------------
// 2.1.4 Character Key Shortcuts

test.describe("2.1.4 character key shortcuts", () => {
  test("every shortcut in the list needs a modifier, or is a key that types nothing", async ({
    page,
  }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    const bad = await page.evaluate(async () => {
      const list = (
        await import("/src/app/settings/shortcutList.ts" as string)
      ).buildShortcuts() as {
        id: string;
        combos: string[];
      }[];
      const NON_PRINTING = /^(Escape|Tab|Enter|F\d+|Arrow\w+|Home|End|PageUp|PageDown)$/;
      const out: string[] = [];
      for (const s of list)
        for (const combo of s.combos) {
          const parts = combo.split("+");
          const key = parts.pop() ?? "";
          const hasModifier = parts.some((p) => p === "Mod" || p === "Alt");
          if (!hasModifier && !NON_PRINTING.test(key)) out.push(`${s.id}: ${combo}`);
        }
      return { out, count: list.length };
    });
    expect(bad.count).toBeGreaterThan(30);
    expect(bad.out).toEqual([]);
  });

  test("a bare printable key is refused as a new shortcut, and a shortcut can be removed or reset", async ({
    page,
  }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Settings" }).click();
    const section = page.locator("#shortcuts");
    const change = section.getByRole("button", { name: "Change shortcut for Bold" });
    await change.click();
    await page.keyboard.press("g");
    await expect(section.getByRole("alert")).toContainText(/Ctrl or Alt|⌘ or ⌥/);
    // Backspace turns the shortcut off; Reset brings the default back.
    await page.keyboard.press("Backspace");
    await expect(section.getByRole("button", { name: "Reset shortcut for Bold" })).toBeVisible();
    await section.getByRole("button", { name: "Reset shortcut for Bold" }).click();
    await expect(section.getByRole("button", { name: "Reset shortcut for Bold" })).toHaveCount(0);
  });

  for (const { name, open } of MAIN.filter((s) =>
    ["editor", "home", "settings"].includes(s.name),
  )) {
    test(`pressing plain letters and digits outside a text field does nothing on ${name}`, async ({
      page,
    }) => {
      await open(page);
      await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
      await page.mouse.click(1, 1);
      // The status bar's counts and page estimate fill in on their own a moment after opening (longer under load), so they are left out.
      const pageText = () =>
        page.evaluate(() => {
          const clone = document.body.cloneNode(true) as HTMLElement;
          clone.querySelectorAll("footer, [role=status]").forEach((n) => n.remove());
          return clone.textContent ?? "";
        });
      const before = {
        ...(await page.evaluate(() => ({
          href: location.href,
          dialogs: document.querySelectorAll("[role=dialog], [role=menu]").length,
        }))),
        text: await pageText(),
      };
      for (const key of "abcdefghijklmnopqrstuvwxyz0123456789/?.,;'[]\\-=`")
        await page.keyboard.press(key);
      for (const key of "ABCDEFGHIJKLMNOPQRSTUVWXYZ") await page.keyboard.press(`Shift+${key}`);
      const after = {
        ...(await page.evaluate(() => ({
          href: location.href,
          dialogs: document.querySelectorAll("[role=dialog], [role=menu]").length,
        }))),
        text: await pageText(),
      };
      expect(after).toEqual(before);
    });
  }
});

// ---------------------------------------------------------------------------------------------------------------------------
// 2.2.2 Pause, Stop, Hide and 2.3.1 Three Flashes

test.describe("2.2.2 and 2.3.1 moving content", () => {
  test("every looping animation is switched off when the system asks for reduced motion", async () => {
    const bad: string[] = [];
    for (const { file, text } of sources()) {
      for (const m of text.matchAll(
        /(["'`])((?:(?!\1)[^\n])*\banimate-(?:spin|pulse|bounce|ping)\b(?:(?!\1)[^\n])*)\1/g,
      )) {
        if (!m[2]!.includes("motion-reduce:animate-none")) bad.push(`${file}: ${m[2]}`);
      }
      // A CSS animation that never ends has to sit in a no-preference media query.
      if (file.endsWith(".css")) {
        const outside = text
          .replace(/@media \(prefers-reduced-motion: no-preference\) \{[\s\S]*?\n\}\n/g, "")
          .match(/animation:[^;]*infinite[^;]*;/g);
        if (outside) bad.push(`${file}: ${outside.join(" ")}`);
      }
    }
    expect(bad).toEqual([]);
  });

  test("the app starts no timer that updates the screen on a loop", async () => {
    const found = sources()
      .filter(({ text }) => /\bsetInterval\s*\(/.test(text))
      .map((s) => s.file);
    expect(found).toEqual([]);
  });

  test("no animation flashes: the app's own loops are slower than 3 per second", async () => {
    // Tailwind's spin turns once a second and pulse takes 2 s; the skeleton takes 1.4 s and only dims to 55%.
    const css = sources()
      .filter((s) => s.file.endsWith(".css"))
      .map((s) => s.text)
      .join("\n");
    const loops = [...css.matchAll(/animation:\s*[\w-]+\s+([\d.]+)(m?s)[^;]*infinite/g)];
    expect(loops.length).toBeGreaterThan(0);
    for (const [, n, unit] of loops)
      expect(Number(n) * (unit === "s" ? 1000 : 1)).toBeGreaterThan(333);
  });

  for (const { name, open } of MAIN) {
    test(`nothing loops on ${name} at rest, with or without reduced motion`, async ({ page }) => {
      for (const motion of ["no-preference", "reduce"] as const) {
        await page.emulateMedia({ reducedMotion: motion });
        await open(page);
        await page.waitForTimeout(250);
        const loops = await page.evaluate(() =>
          document
            .getAnimations()
            .filter((a) => a.effect?.getComputedTiming().iterations === Infinity)
            .map((a) => String((a.effect as KeyframeEffect).target?.className ?? "").slice(0, 60)),
        );
        expect(loops, motion).toEqual([]);
      }
    });
  }
});

// ---------------------------------------------------------------------------------------------------------------------------
// 1.4.2 Audio Control

test.describe("1.4.2 audio control", () => {
  test("no audio or video starts by itself, and each player has controls or a stop button", async () => {
    const files = sources();
    const autoplay = files.filter(({ text }) => /autoPlay|autoplay/.test(text)).map((f) => f.file);
    expect(autoplay).toEqual([]);
    for (const { file, text } of files)
      for (const tag of text.matchAll(/<(audio|video)\s[^>]*>/g))
        expect(tag[0], `${file}: ${tag[0]}`).toMatch(/\bcontrols\b/);
    // Sound only comes from the Hear sample button (which turns into Stop) and the author's own reference players.
    const players = files
      .filter(({ text }) => /new Audio\(|AudioContext/.test(text))
      .map((f) => f.file);
    expect(players).toEqual(["src/app/export/useAudioExport.ts"]);
    const hook = files.find((f) => f.file.endsWith("useAudioExport.ts"))!.text;
    expect(hook).toMatch(/if \(sample === "playing"\) return stopSample\(\)/);
  });

  test("Hear sample plays on a press and the same button stops it", async ({ page }) => {
    await page.addInitScript(() => {
      const w = window as unknown as { __plays: string[] };
      w.__plays = [];
      HTMLMediaElement.prototype.play = function () {
        w.__plays.push("play");
        return Promise.resolve();
      };
      HTMLMediaElement.prototype.pause = function () {
        w.__plays.push("pause");
      };
    });
    await newProject(page);
    await page.getByRole("button", { name: "Export", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Export book" });
    await dialog.getByRole("radio", { name: "Audiobook" }).click();
    await page.waitForTimeout(300);
    expect(await page.evaluate(() => (window as never as { __plays: string[] }).__plays)).toEqual(
      [],
    );
    const hear = dialog.getByRole("button", { name: /hear|sample/i }).first();
    await expect(hear).toBeVisible();
    await hear.click();
    await expect(dialog.getByRole("button", { name: /stop/i }).first()).toBeVisible();
    await dialog.getByRole("button", { name: /stop/i }).first().click();
    await expect(dialog.getByRole("button", { name: /hear|sample/i }).first()).toBeVisible();
  });
});

// ---------------------------------------------------------------------------------------------------------------------------
// 2.4.2 Page Titled

test.describe("2.4.2 page titled", () => {
  for (const { name, open } of screens) {
    test(`${name} has a title that ends with the app name`, async ({ page }) => {
      await open(page);
      await expect.poll(() => page.title()).toMatch(/ - CadabraCraft$|^CadabraCraft$/);
    });
  }

  test("the title says which screen you are on and which book is open", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    const home = await page.title();
    await newProject(page);
    const editor = await page.title();
    await page.getByRole("button", { name: "Settings" }).click();
    await expect(page.getByRole("heading", { name: "Settings", level: 1 })).toBeVisible();
    const settings = await page.title();
    expect(new Set([home, editor, settings]).size).toBe(3);
    expect(editor).toContain("E2E Book");
    expect(settings).toContain("Settings");
  });
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
          out.push([icon, name.replace(/^(Actions for|Undo:|Redo:)\s.*$/, "$1").trim() || name]);
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
      "lucide-a-large-small": "Small caps (format) and Reading settings (the Read mode panel)",
    };
    const report = [...byIcon]
      .filter(([icon, names]) => icon && names.size > 1 && !(icon in REVIEWED))
      .map(([icon, names]) => `${icon}: ${[...names.keys()].join(" / ")}`);
    expect(report).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------------------------------------
// 1.3.3 Sensory Characteristics

test.describe("1.3.3 sensory characteristics", () => {
  // Instructions that name only a place, colour or shape ("the button on the right", "the red icon").
  const SENSORY =
    /\b(on the|to the|at the)\s+(left|right|top|bottom)\b|\b(left|right)[- ]hand\b|\b(above|below)\b(?! the)|\b(red|green|blue|yellow|orange)\s+(button|icon|text|dot|badge|line|circle|square)\b|\b(round|square|circular|triangular)\s+(button|icon)\b|\bclick the (?:\w+ )?(?:icon|button|dot)\b/i;
  // Reviewed matches that are names or measurements, not directions to look somewhere: the table commands "Add Row Below" and
  // "Add Column After" name an action, and the bleed hint says which edges of the printed page grow.
  const DESCRIPTIVE = [
    /\bAdd (Row|Column) (Above|Below)\b/,
    /on the top, bottom and outside edges/,
  ];
  for (const { name, open } of screens) {
    test(`no instruction on ${name} points only by place, colour or shape`, async ({ page }) => {
      await open(page);
      const text = await page.evaluate(() =>
        [
          document.body.innerText,
          ...[...document.querySelectorAll("[aria-label], [title], [placeholder]")].flatMap((e) => [
            e.getAttribute("aria-label"),
            e.getAttribute("title"),
            e.getAttribute("placeholder"),
          ]),
        ]
          .filter(Boolean)
          .join("\n"),
      );
      const hits = text
        .split("\n")
        .filter((l) => SENSORY.test(l) && !DESCRIPTIVE.some((d) => d.test(l)));
      expect(hits).toEqual([]);
    });
  }
});

// ---------------------------------------------------------------------------------------------------------------------------
// 1.3.5 Identify Input Purpose and 3.3.7 Redundant Entry

/** Field labels that ask for a fact about the person using the app (the WCAG 2.2 list of input purposes). */
const ABOUT_THE_USER =
  /^(name|full name|first name|last name|given name|family name|e-?mail( address)?|phone|telephone|username|password|street address|postal code|zip|city|country|birthday|credit card|card number)$/i;

test.describe("1.3.5 identify input purpose", () => {
  for (const { name, open } of screens) {
    test(`no field on ${name} asks the person for their own details without an autocomplete purpose`, async ({
      page,
    }) => {
      await open(page);
      const fields = await page.evaluate(() =>
        [
          ...document.querySelectorAll<HTMLInputElement>(
            "input:not([type=hidden]):not([type=checkbox]):not([type=radio]), textarea",
          ),
        ].map((el) => ({
          label: (el.labels?.[0]?.textContent ?? el.getAttribute("aria-label") ?? "")
            .replace(/\s+/g, " ")
            .trim(),
          autocomplete: el.getAttribute("autocomplete") ?? "",
        })),
      );
      const bad = fields.filter((f) => ABOUT_THE_USER.test(f.label) && !f.autocomplete);
      expect(bad).toEqual([]);
    });
  }

  test("the book's author field is not a field about the user (it names the book's author)", async ({
    page,
  }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "New project" }).click();
    const author = page.getByRole("dialog", { name: "New book" }).getByLabel("Author");
    // The author of a book is often someone else (a client, a translator's source), so no autofill purpose applies.
    expect(await author.getAttribute("autocomplete")).toBeNull();
  });
});

test.describe("3.3.7 redundant entry", () => {
  test("what was typed for the new book is already in every later form that asks for it", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await newProject(page);
    const values: Record<string, string[]> = {};
    const collect = async (where: string) => {
      await expect(page.getByRole("dialog")).toBeVisible();
      await page.waitForTimeout(300); // the form is filled a moment after the dialog opens
      values[where] = await page.evaluate(() =>
        [
          ...document.querySelectorAll<HTMLInputElement>(
            "[role=dialog] input:not([type=checkbox]):not([type=radio]):not([type=hidden]), [role=dialog] textarea",
          ),
        ].map(
          (el) =>
            `${(el.labels?.[0]?.textContent ?? el.getAttribute("aria-label") ?? "").trim()}=${el.value}`,
        ),
      );
    };
    await page.getByRole("button", { name: "Book details" }).first().click();
    await collect("Book details");
    await page.keyboard.press("Escape");
    for (const format of ["EPUB 3", "Print PDF", "Audiobook"]) {
      await page.getByRole("button", { name: "Export", exact: true }).click();
      await page
        .getByRole("dialog", { name: "Export book" })
        .getByRole("radio", { name: format })
        .click();
      await collect(`Export ${format}`);
      await page.keyboard.press("Escape");
    }
    // Title and author are asked once, in New book, and show up filled everywhere else.
    expect(values["Book details"]).toEqual(
      expect.arrayContaining(["Title=E2E Book", "Author=Tester"]),
    );
    for (const [where, fields] of Object.entries(values))
      for (const f of fields.filter((x) => /^(Title|Author|Language|Folder)=/.test(x)))
        expect(f, where).not.toMatch(/=$/);
  });

  test("no form asks the person to type the same thing twice", async ({ browser, baseURL }) => {
    test.setTimeout(300_000);
    for (const s of screens) {
      const page = await fresh(browser, baseURL);
      await s.open(page);
      const labels = await page.evaluate(() =>
        [
          ...document.querySelectorAll<HTMLInputElement>(
            "input:not([type=hidden]):not([type=checkbox]):not([type=radio])",
          ),
        ].map((el) =>
          (el.labels?.[0]?.textContent ?? el.getAttribute("aria-label") ?? "").trim().toLowerCase(),
        ),
      );
      expect(
        labels.filter((l) => /confirm|repeat|retype|re-enter|again/.test(l)),
        s.name,
      ).toEqual([]);
      expect(
        labels.length - new Set(labels.filter(Boolean)).size,
        `${s.name}: ${labels.join(", ")}`,
      ).toBe(0);
      await page.context().close();
    }
  });
});

// ---------------------------------------------------------------------------------------------------------------------------
// 2.5.2 Pointer Cancellation

test.describe("2.5.2 pointer cancellation", () => {
  test("the only handlers on pointer-down start a reorder drag (the drop happens on release)", async () => {
    const found = sources()
      .flatMap(({ file, text }) =>
        [...text.matchAll(/on(?:Mouse|Pointer|Touch)Down=\{([^}\n]*)\}?/g)].map(
          (m) => `${file}: ${m[0]}`,
        ),
      )
      .filter((l) => !/preventDefault\(\)/.test(l));
    // Reorder grips (TocRow, ReferenceRow, ImportChapterList) only pick the row up: the move is committed on release, with Escape to cancel.
    expect(found.map((l) => l.split(":")[0]).sort()).toEqual([
      "src/app/dialogs/ImportChapterList.tsx",
      "src/app/references/ReferenceRow.tsx",
      "src/app/toc/TocRow.tsx",
    ]);
  });

  test("pressing a button and releasing off it does not run it", async ({ page }) => {
    await page.goto("/");
    const button = page.getByRole("button", { name: "New project" });
    const box = (await button.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height + 120, { steps: 4 });
    await page.mouse.up();
    await expect(page.getByRole("dialog", { name: "New book" })).toHaveCount(0);
    // And a press-and-release on it does run it.
    await button.click();
    await expect(page.getByRole("dialog", { name: "New book" })).toBeVisible();
  });

  test("a menu or toolbar button run on release, and moving off before release cancels", async ({
    page,
  }) => {
    await newProject(page);
    const bold = page
      .getByRole("toolbar", { name: "Formatting" })
      .getByRole("button", { name: "Bold", exact: true });
    const box = (await bold.boundingBox())!;
    await page.locator(".ProseMirror p").last().click();
    await page.mouse.move(box.x + 4, box.y + 4);
    await page.mouse.down();
    await expect(bold).toHaveAttribute("aria-pressed", "false");
    await page.mouse.move(box.x + 4, box.y + box.height + 200, { steps: 4 });
    await page.mouse.up();
    await expect(bold).toHaveAttribute("aria-pressed", "false");

    const menu = page.getByRole("button", { name: "Actions for Chapter One" });
    const m = (await menu.boundingBox())!;
    await page.mouse.move(m.x + m.width / 2, m.y + m.height / 2);
    await page.mouse.down();
    // A menu is opened by the press (Radix), is not a destructive action and closes with Escape or a click away; the items inside run on release.
    await page.mouse.move(m.x - 300, m.y + 300, { steps: 4 });
    await page.mouse.up();
    const items = page.getByRole("menuitem");
    if ((await items.count()) > 0) {
      await expect(page.getByRole("dialog")).toHaveCount(0);
      await page.keyboard.press("Escape");
    }
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });
});

// ---------------------------------------------------------------------------------------------------------------------------
// 1.4.13 Content on Hover or Focus

test.describe("1.4.13 content on hover or focus", () => {
  test("the app builds no tooltip or popover that shows on hover or focus, except the print preview's Edit this page hint", async () => {
    const hits = sources()
      .filter(
        ({ file, text }) =>
          // TypstSpread is the print preview's hint (tested below); Toolbar's onFocus only tracks which button the arrow keys start from.
          // ui/Dialog.tsx's onFocus scrolls the focused control into view.
          !/TypstSpread|editor\/Toolbar\.tsx$|ui\/Dialog\.tsx$/.test(file) &&
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
          count: document.body.getElementsByTagName("*").length,
          tooltips: document.querySelectorAll("[role=tooltip], [popover]:popover-open").length,
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
