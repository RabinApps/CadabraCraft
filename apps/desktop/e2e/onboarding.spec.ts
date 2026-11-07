import { expect, test, type Page } from "./support/coverage";
import { fakeTauri } from "./support/fakeTauri";
import { newProject } from "./support/helpers";
import { covBackend, failOn } from "./support/cov";

test.beforeEach(async ({ page }) => {
  await fakeTauri(page);
  // The fake backend starts past the welcome screen (it would cover the page in every other spec). This puts the first
  // load of each test back on its first run; later loads see what the author chose.
  await page.addInitScript(() => {
    if (sessionStorage.getItem("onboardingTest")) return;
    sessionStorage.setItem("onboardingTest", "1");
    localStorage.setItem("cadabracraft.onboarding", "unseen");
  });
});

const welcome = (page: Page) => page.getByRole("heading", { name: "Welcome to CadabraCraft" });
const FEATURES = [
  "Write the whole book",
  "Bring what you have",
  "Publish EPUB and print PDF",
  "Listen, or hand it off",
  "Translate your book",
  "Yours, on your computer",
];

test.describe("welcome screen on the first run", () => {
  test("opens by itself, lists what the app does and who pays for it", async ({ page }) => {
    await page.goto("/");
    await expect(welcome(page)).toBeVisible();
    await expect(page.getByRole("heading", { name: "Welcome to CadabraCraft" })).toBeFocused();
    await expect(
      page.getByText("Write, format and publish your book — everything stays on your computer."),
    ).toBeVisible();
    for (const name of FEATURES)
      await expect(page.getByRole("heading", { name, level: 2 })).toBeVisible();
    await expect(page.getByText("CadabraCraft is 100% supported by sponsors.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Get started" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Sponsor CadabraCraft" })).toBeVisible();
  });

  test("Get started opens Home, and the welcome screen does not return", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Get started" }).click();
    await expect(page.getByRole("heading", { name: "Write your first book" })).toBeVisible();
    expect(await page.evaluate(() => localStorage.getItem("cadabracraft.onboarding"))).toBe("seen");
    await page.reload();
    await expect(page.getByRole("heading", { name: "Write your first book" })).toBeVisible();
    await expect(welcome(page)).toHaveCount(0);
  });

  test("Help > Welcome to CadabraCraft… brings it back over the open book", async ({ page }) => {
    // Registered last, so the book can be created without the first-run screen in the way.
    await page.addInitScript(() => localStorage.setItem("cadabracraft.onboarding", "seen"));
    await newProject(page);
    await page.waitForFunction(() => "__cadabraMenu" in window);
    await page.evaluate(() =>
      (window as never as { __cadabraMenu: { run: (id: string) => void } }).__cadabraMenu.run(
        "help.welcome",
      ),
    );
    await expect(welcome(page)).toBeVisible();
    await page.getByRole("button", { name: "Get started" }).click();
    await expect(page.locator(".ProseMirror h1")).toHaveText("Chapter One");
  });

  test("Sponsor opens only the sponsor page, in the author's browser", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Sponsor CadabraCraft" }).click();
    expect(await page.evaluate(() => window.__opened)).toEqual([
      "https://github.com/sponsors/RabinApps",
    ]);
    await expect(welcome(page)).toBeVisible();
  });

  test("a browser that cannot be opened is reported, and the page is not lost", async ({
    page,
  }) => {
    await covBackend(page);
    await page.goto("/");
    await failOn(page, "plugin:opener|open_url", "no browser");
    await page.getByRole("button", { name: "Sponsor CadabraCraft" }).click();
    await expect(page.getByRole("alert")).toContainText(
      "Could not open https://github.com/sponsors/RabinApps: no browser. Copy the address into your browser instead.",
    );
    await expect(welcome(page)).toBeVisible();
    await expect(page.getByRole("button", { name: "Get started" })).toBeEnabled();
  });
});
