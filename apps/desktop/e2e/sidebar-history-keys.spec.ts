import { expect, test } from "./support/coverage";
import { fakeTauri } from "./support/fakeTauri";
import { newProject } from "./support/helpers";

// The book history buttons name the shortcut of the platform: Command-based on a Mac, Control-based elsewhere.
for (const [platform, undo, redo] of [
  ["MacIntel", "Meta+Alt+Z", "Meta+Alt+Shift+Z"],
  ["Win32", "Control+Alt+Z", "Control+Alt+Shift+Z"],
] as const) {
  test(`book undo and redo advertise their ${platform} shortcuts`, async ({ page }) => {
    await page.addInitScript((value) => {
      Object.defineProperty(navigator, "platform", { get: () => value });
    }, platform);
    await fakeTauri(page);
    await page.setViewportSize({ width: 1280, height: 800 });
    await newProject(page);
    const group = page.getByRole("group", { name: "Book history" });
    await expect(group.getByRole("button", { name: /^Undo/ })).toHaveAttribute(
      "aria-keyshortcuts",
      undo,
    );
    await expect(group.getByRole("button", { name: /^Redo/ })).toHaveAttribute(
      "aria-keyshortcuts",
      redo,
    );
  });
}
