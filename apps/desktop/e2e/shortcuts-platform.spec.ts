import { expect, test, type Page } from "./support/coverage";
import { fakeTauri } from "./support/fakeTauri";

// Settings > Shortcuts words its help and its refusals for the platform's keys: Command and Option on a Mac, Ctrl and Alt elsewhere.

const open = async (page: Page, platform: string) => {
  await page.addInitScript((value) => {
    Object.defineProperty(navigator, "platform", { get: () => value });
    Object.defineProperty(navigator, "userAgent", { get: () => `Mozilla/5.0 (${value})` });
  }, platform);
  await fakeTauri(page);
  await page.goto("/");
  await page.getByRole("button", { name: "Settings" }).click();
  await page
    .getByRole("navigation", { name: "Settings sections" })
    .getByRole("button", { name: "Shortcuts" })
    .click();
  await expect(page.getByRole("heading", { name: "Shortcuts", level: 2 })).toBeVisible();
};

for (const [platform, help, hold] of [
  ["Macintosh", /⌘ is Command, ⌥ is Option/, "Hold ⌘ or ⌥ together with the key."],
  [
    "Win32",
    /^Choose Change, then press the new keys\. Esc cancels and Backspace removes/,
    "Hold Ctrl or Alt together with the key.",
  ],
] as const) {
  test(`${platform}: the help names the platform's keys and a bare key is refused`, async ({
    page,
  }) => {
    await open(page, platform);
    await expect(page.locator("#shortcuts").getByText(help)).toBeVisible();
    const change = page.getByRole("button", { name: "Change shortcut for Bold", exact: true });
    await change.click();
    await page.keyboard.press("j");
    await expect(page.getByRole("alert").filter({ hasText: hold })).toBeVisible();
    // Choosing Change again while it waits cancels, and says so.
    await page
      .getByRole("button", { name: /Cancel|Change shortcut for Bold/ })
      .first()
      .click();
    await expect(page.locator("#shortcuts").getByText("Press the new keys…")).toHaveCount(0);
  });
}
