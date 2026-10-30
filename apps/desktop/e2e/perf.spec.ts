import { expect, test } from "./support/coverage";
import { bigChapter } from "../src/test/bigBook";
import { fakeTauri } from "./support/fakeTauri";
import { newProject, focusEnd } from "./support/helpers";

test.beforeEach(async ({ page }) => {
  await fakeTauri(page);
});

test("typing stays responsive in a 20,000-word chapter", async ({ page }) => {
  await newProject(page);
  const big = JSON.stringify(bigChapter(20_000, 99, "Long"), null, 2);
  await page.evaluate((json) => {
    window.__disk["manuscript/001-chapter-one.json"] = json;
    sessionStorage.setItem("disk", JSON.stringify(window.__disk));
  }, big);
  await page.reload();
  await page.getByRole("button", { name: "Open folder" }).click();
  await expect(page.locator(".ProseMirror h1")).toHaveText("Long");
  await focusEnd(page);
  // Time from each keydown to the second frame after it, as the author would feel it.
  await page.evaluate(() => {
    const lat: number[] = [];
    window.__lat = lat;
    window.addEventListener(
      "keydown",
      () => {
        const t0 = performance.now();
        requestAnimationFrame(() => requestAnimationFrame(() => lat.push(performance.now() - t0)));
      },
      true,
    );
  });
  for (let i = 0; i < 40; i++) await page.keyboard.type("x");
  await expect.poll(() => page.evaluate(() => window.__lat.length)).toBe(40);
  const sorted = [...(await page.evaluate(() => window.__lat as number[]))].sort((a, b) => a - b);
  console.info(
    `[perf] typing in a 20k-word chapter: median ${sorted[20]!.toFixed(1)} ms, worst ${sorted[39]!.toFixed(1)} ms`,
  );
  // Generous ceilings, well above what the dev machine measures, to still catch a per-keystroke pass over the whole document.
  expect(sorted[20]!).toBeLessThan(500);
  expect(sorted[39]!).toBeLessThan(1500);
});
