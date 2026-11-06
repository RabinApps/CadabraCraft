import { expect, test } from "../support/coverage";
import { fakeTauri } from "../support/fakeTauri";
import { screens } from "../support/a11yScreens";
import { newProject } from "../support/helpers";
import { MAIN, sources } from "../support/a11yWcagExtra";

test.beforeEach(async ({ page }) => {
  await fakeTauri(page);
});

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
    expect(players).toEqual(["src/app/export/parts/useAudioSample.ts"]);
    const hook = files.find((f) => f.file.endsWith("useAudioSample.ts"))!.text;
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
