import type { Page } from "@playwright/test";
import { expect, test } from "./support/coverage";
import { fakeTauri } from "./support/fakeTauri";
import { screens } from "./support/a11yScreens";
import { audit } from "./support/audit";

// Gaps left by the other a11y specs, for the settings an operating system hands to the page: forced colors, reduced
// motion, dark mode followed from the OS (not set by hand) and a 2x display. Windows High Contrast, macOS "Reduce
// motion" and a real retina panel still need the manual passes in docs/platform-checks.md; this is the emulation.

const TOP = ["home", "editor", "settings", "export dialog"];
const top = screens.filter((s) => TOP.includes(s.name));

test.beforeEach(async ({ page }) => {
  await fakeTauri(page);
});

const luminance = (c: string) => {
  const [r, g, b] = (c.match(/[\d.]+/g) ?? []).slice(0, 3).map((v) => {
    const x = Number(v) / 255;
    return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
};
const ratio = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
};

/** Waits for dialog and color animations to finish so computed styles are the resting ones. */
const settle = (page: Page) =>
  page.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished.catch(() => {}))));

// Following the OS: no theme was chosen by hand, so "system" is resolved from prefers-color-scheme.
test.describe("dark mode follows the operating system", () => {
  for (const scheme of ["light", "dark"] as const) {
    test(`${scheme}: the theme and the text contrast follow the OS on the top screens`, async ({
      page,
    }) => {
      await page.emulateMedia({ colorScheme: scheme });
      for (const { name, open } of top) {
        await open(page);
        await settle(page);
        expect(
          await page.evaluate(() => document.documentElement.dataset.theme),
          `theme on ${name}`,
        ).toBe(scheme);
        const colors = await page.evaluate(() => {
          const h = document.querySelector("h1, h2, [role=dialog] h2") ?? document.body;
          const behind = (el: Element) => {
            for (let e: Element | null = el; e; e = e.parentElement) {
              const bg = getComputedStyle(e).backgroundColor;
              if (!/rgba?\(.*,\s*0\)$/.test(bg) && bg !== "transparent") return bg;
            }
            return getComputedStyle(document.body).backgroundColor;
          };
          return { fg: getComputedStyle(h).color, bg: behind(h) };
        });
        expect(ratio(colors.fg, colors.bg), `heading contrast on ${name}`).toBeGreaterThanOrEqual(
          4.5,
        );
      }
    });
  }

  test("switching the OS appearance while the app is open changes the theme without a reload", async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: "light" });
    await page.goto("/");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    await page.emulateMedia({ colorScheme: "dark" });
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await page.emulateMedia({ colorScheme: "light" });
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  });
});

test.describe("reduced motion on the top screens", () => {
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
  });

  for (const { name, open } of top) {
    test(`nothing slides, zooms or loops on ${name}`, async ({ page }) => {
      await open(page);
      await settle(page);
      const moving = await page.evaluate(() =>
        [...document.querySelectorAll("body *")].flatMap((el) => {
          const s = getComputedStyle(el);
          const label = `${el.tagName.toLowerCase()}.${String(el.className).slice(0, 40)}`;
          const out: string[] = [];
          if (
            s.animationName !== "none" &&
            s.animationDuration.split(",").some((d) => parseFloat(d) > 0.001)
          )
            out.push(`animation ${s.animationName} on ${label}`);
          const props = s.transitionProperty.split(",").map((p) => p.trim());
          const times = s.transitionDuration
            .split(",")
            .map((v) => parseFloat(v) * (v.includes("ms") ? 1e-3 : 1));
          props.forEach((p, i) => {
            if (
              /^(all|transform|translate|scale|rotate)/.test(p) &&
              (times[i % times.length] ?? 0) > 0.001
            )
              out.push(`transition ${p} on ${label}`);
          });
          return out;
        }),
      );
      expect(moving).toEqual([]);
    });
  }
});

test.describe("forced colors on home and settings", () => {
  // A button drawn only with a fill disappears in forced colors; it needs a border or an outline of its own.
  for (const name of ["home", "settings"]) {
    const screen = top.find((s) => s.name === name)!;
    test(`every filled control on ${name} keeps an edge or text`, async ({ page }) => {
      await screen.open(page);
      await settle(page);
      // Controls drawn by our CSS (not the browser's native ones) that have a fill and no word on them.
      await page.evaluate(() => {
        for (const el of document.querySelectorAll<HTMLElement>(
          "button, [role=switch], [role=radio]",
        )) {
          const bg = getComputedStyle(el).backgroundColor;
          const filled = !/rgba?\(.*,\s*0\)$/.test(bg) && bg !== "transparent";
          const wordless = !(el.textContent ?? "").trim();
          if (
            filled &&
            wordless &&
            el.getClientRects().length > 0 &&
            !el.closest(".sr-only, [inert]")
          )
            el.dataset.filledWordless = el.getAttribute("aria-label") ?? el.tagName;
        }
      });
      await page.emulateMedia({ forcedColors: "active" });
      await settle(page);
      const missing = await page.evaluate(() => {
        const edge = (s: CSSStyleDeclaration) =>
          (s.borderTopStyle !== "none" && parseFloat(s.borderTopWidth) > 0) ||
          (s.outlineStyle !== "none" && parseFloat(s.outlineWidth) > 0);
        return [...document.querySelectorAll<HTMLElement>("[data-filled-wordless]")]
          .filter((el) => !edge(getComputedStyle(el)))
          .map((el) => `${el.getAttribute("role") ?? el.tagName} "${el.dataset.filledWordless}"`);
      });
      // Filled controls with no visible word and no edge are invisible in forced colors.
      expect(missing).toEqual([]);
    });

    test(`${name} has no text that forced colors makes unreadable (color adjusted, nothing hidden)`, async ({
      page,
    }) => {
      await page.emulateMedia({ forcedColors: "active" });
      await screen.open(page);
      await settle(page);
      const bad = await page.evaluate(() => {
        const canvas = getComputedStyle(document.body).backgroundColor;
        return [...document.querySelectorAll("h1, h2, h3, p, label, button")]
          .filter((el) => el.getClientRects().length > 0 && el.textContent?.trim())
          .filter((el) => {
            const s = getComputedStyle(el);
            return s.color === canvas || s.opacity === "0" || s.visibility === "hidden";
          })
          .map((el) => el.textContent!.trim().slice(0, 30));
      });
      expect(bad).toEqual([]);
    });
  }
});

test.describe("a 2x display (deviceScaleFactor 2)", () => {
  test.use({ deviceScaleFactor: 2 });

  for (const { name, open } of top) {
    test(`${name}: no sideways scroll, nothing clipped, no hairline thinner than 1 CSS px`, async ({
      page,
    }) => {
      await open(page);
      await settle(page);
      expect(await page.evaluate(() => window.devicePixelRatio)).toBe(2);
      expect(
        (await audit(page)).filter((i) => i.kind === "scroll-x" || i.kind === "clipped"),
      ).toEqual([]);
      // Borders are authored in CSS pixels: at 2x a 1px border is two device pixels, never rounded away to 0.
      const lost = await page.evaluate(() =>
        [...document.querySelectorAll("button, input, select, [role=dialog]")]
          .filter((el) => el.getClientRects().length > 0)
          .filter((el) => {
            const s = getComputedStyle(el);
            const w = parseFloat(s.borderTopWidth);
            return s.borderTopStyle !== "none" && w > 0 && w < 1;
          })
          .map(
            (el) =>
              `${el.tagName.toLowerCase()}[${(el.getAttribute("aria-label") ?? el.textContent ?? "").trim().slice(0, 20)}]`,
          ),
      );
      expect(lost).toEqual([]);
    });
  }
});
