import { expect, test } from "./support/coverage";
import { fakeTauri } from "./support/fakeTauri";
import { newProject } from "./support/helpers";

// The sprint timer in the status bar (M03). The sprint runs in real time; a sprint seeded two seconds short of its end
// finishes within the test, so no fake clock is needed.

const MIN = 60_000;

test.beforeEach(async ({ page }) => {
  await fakeTauri(page);
});

/** Seeds the saved settings before the app starts: a paused sprint, `elapsedMs` into a `minutes` sprint. */
function seedSprint(minutes: number, elapsedMs: number) {
  return {
    typewriterScroll: false,
    sprint: { durationMs: minutes * MIN, elapsedMs, runningSince: null },
  };
}

test("the sprint timer starts, pauses, resets and changes length", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await newProject(page);
  const timer = () =>
    page
      .locator("button[aria-expanded]")
      .filter({ hasText: /Sprint|\d{2}:\d{2}/ })
      .first();
  await expect(timer()).toHaveText("Sprint 25:00");

  await timer().click();
  const panel = page.getByRole("region", { name: "Sprint" });
  await expect(panel).toBeVisible();

  await panel.getByRole("button", { name: "Start", exact: true }).click();
  await expect(timer()).toHaveText(/ left$/);

  await panel.getByRole("button", { name: "Pause", exact: true }).click();
  await expect(timer()).toHaveText(/ paused$/);
  const paused = await timer().textContent();
  await page.waitForTimeout(1500);
  await expect(timer()).toHaveText(paused ?? "");

  await panel.getByRole("button", { name: "Reset" }).click();
  await expect(timer()).toHaveText("Sprint 25:00");

  await panel.getByRole("button", { name: "15 min" }).click();
  await expect(timer()).toHaveText("Sprint 15:00");
  await expect(panel.getByRole("button", { name: "15 min" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );

  await page.keyboard.press("Escape");
  await expect(panel).toBeHidden();
  await expect(timer()).toBeFocused();
});

test("a sprint that runs out says so once, and Start again begins a new one", async ({ page }) => {
  await page.addInitScript(
    (seed) => {
      localStorage.setItem("cadabracraft.settings", JSON.stringify(seed));
    },
    seedSprint(15, 15 * MIN - 2000),
  );
  await page.setViewportSize({ width: 1280, height: 800 });
  await newProject(page);
  const timer = () =>
    page
      .locator("button[aria-expanded]")
      .filter({ hasText: /Sprint|\d{2}:\d{2}/ })
      .first();
  await expect(timer()).toHaveText("00:02 paused");

  await page.getByRole("button", { name: "Resume sprint" }).click();
  await expect(timer()).toHaveText("Sprint done", { timeout: 10_000 });
  await expect(
    page.locator('[aria-live="polite"]').filter({ hasText: "Sprint done. Nice work." }),
  ).toHaveCount(1);

  await timer().click();
  const panel = page.getByRole("region", { name: "Sprint" });
  await expect(panel.getByRole("button", { name: "Start again" })).toBeVisible();
  await panel.getByRole("button", { name: "Start again" }).click();
  await expect(timer()).toHaveText(/ left$/);
  await expect(page.locator('[aria-live="polite"]').filter({ hasText: "Sprint done" })).toHaveCount(
    0,
  );
});
