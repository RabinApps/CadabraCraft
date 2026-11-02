import { expect, test, type Page } from "./support/coverage";
import { fakeTauri } from "./support/fakeTauri";
import { newProject } from "./support/helpers";

// Settings > Shortcuts: a searchable list of every key the app answers to, with rebinding.

test.beforeEach(async ({ page }) => {
  await fakeTauri(page);
});

const openShortcuts = async (page: Page) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Settings" }).click();
  await page
    .getByRole("navigation", { name: "Settings sections" })
    .getByRole("button", { name: "Shortcuts" })
    .click();
  await expect(page.getByRole("heading", { name: "Shortcuts", level: 2 })).toBeVisible();
};

test("the Shortcuts nav entry is enabled and lists keys by menu", async ({ page }) => {
  await openShortcuts(page);
  const section = page.locator("#shortcuts");
  for (const group of ["File", "Edit", "Format"])
    await expect(section.getByRole("heading", { name: group, level: 3 })).toBeVisible();
  await expect(section.getByRole("listitem").filter({ hasText: "Bold" })).toBeVisible();
  // Keycaps are announced as words, not as symbols.
  await expect(section.getByRole("img", { name: /^(Control|Command) B$/ })).toBeVisible();
});

test("search matches the action and the key, and says when nothing matches", async ({ page }) => {
  await openShortcuts(page);
  const section = page.locator("#shortcuts");
  const search = section.getByRole("searchbox", { name: "Search shortcuts" });
  await search.fill("bold");
  await expect(section.getByRole("listitem")).toHaveCount(1);
  await expect(section.getByRole("heading", { name: "File", level: 3 })).toHaveCount(0);
  await search.fill("shift+s");
  await expect(section.getByRole("listitem").filter({ hasText: "Strikethrough" })).toBeVisible();
  await search.fill("zzzz");
  await expect(section.getByRole("status")).toHaveText(/No shortcut matches “zzzz”/);
  await search.fill("");
  await expect(section.getByRole("heading", { name: "File", level: 3 })).toBeVisible();
});

const row = (page: Page, action: string) =>
  page.locator("#shortcuts").getByRole("listitem").filter({ hasText: action });
const change = (page: Page, action: string) =>
  page.getByRole("button", { name: `Change shortcut for ${action}`, exact: true });
const keycaps = (page: Page, action: string, spoken: RegExp) =>
  row(page, action).getByRole("img", { name: spoken });
const storedOverrides = (page: Page) =>
  page.evaluate(() => JSON.parse(localStorage.getItem("cadabracraft.settings")!).shortcutOverrides);
const BOLD = /^(Control|Command) B$/;

test.describe("rebinding", () => {
  test("a new key replaces the old one, shows a Reset, and survives a reload", async ({ page }) => {
    await openShortcuts(page);
    await expect(page.getByRole("button", { name: "Reset all" })).toBeDisabled();
    await change(page, "Bold").click();
    await expect(row(page, "Bold")).toContainText("Press the new keys…");
    await page.keyboard.press("ControlOrMeta+Alt+j");
    await expect(row(page, "Bold")).not.toContainText("Press the new keys…");
    await expect(keycaps(page, "Bold", / J$/)).toBeVisible();
    await expect(keycaps(page, "Bold", BOLD)).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Reset all" })).toBeEnabled();
    expect(await storedOverrides(page)).toEqual({ "editor.bold": "Mod+Alt+J" });

    await page.reload();
    await page.getByRole("button", { name: "Settings" }).click();
    await page
      .getByRole("navigation", { name: "Settings sections" })
      .getByRole("button", { name: "Shortcuts" })
      .click();
    await expect(keycaps(page, "Bold", / J$/)).toBeVisible();
    // Reset puts the default back and removes the stored entry.
    await page.getByRole("button", { name: "Reset shortcut for Bold" }).click();
    await expect(keycaps(page, "Bold", BOLD)).toBeVisible();
    expect(await storedOverrides(page)).toEqual({});
  });

  test("the new key formats text and the old one no longer does", async ({ page }) => {
    await openShortcuts(page);
    await change(page, "Bold").click();
    await page.keyboard.press("ControlOrMeta+Alt+j");
    await newProject(page);
    const ed = page.locator(".ProseMirror");
    await ed.locator("p").last().click();
    await page.keyboard.type("styled");
    await ed.locator("p").last().click({ clickCount: 3 });
    await page.keyboard.press("ControlOrMeta+b");
    await expect(ed.locator("strong")).toHaveCount(0);
    await page.keyboard.press("ControlOrMeta+Alt+j");
    await expect(ed.locator("strong")).toHaveText("styled");
    // The other editor keys are untouched.
    await page.keyboard.press("ControlOrMeta+i");
    await expect(ed.locator("em")).toHaveText("styled");
  });

  test("a window-level key moves too (the command palette)", async ({ page }) => {
    await openShortcuts(page);
    await change(page, "Command Palette").click();
    await page.keyboard.press("ControlOrMeta+j");
    await newProject(page);
    const box = page.getByRole("combobox", { name: "Command palette" });
    await page.keyboard.press("ControlOrMeta+k");
    await expect(box).toHaveCount(0);
    await page.keyboard.press("ControlOrMeta+j");
    await expect(box).toBeFocused();
  });

  test("a taken key is refused with its owner named; Esc cancels; Backspace removes; Reset all restores", async ({
    page,
  }) => {
    await openShortcuts(page);
    await change(page, "Bold").click();
    await page.keyboard.press("ControlOrMeta+i");
    await expect(row(page, "Bold").getByRole("alert")).toHaveText(/Already used by “Italic”/);
    // The system's Copy is listed but fixed.
    await page.keyboard.press("ControlOrMeta+c");
    await expect(row(page, "Bold").getByRole("alert")).toHaveText(/Already used by “Copy”/);
    // A key without Ctrl/Cmd/Alt would be typed text.
    await page.keyboard.press("j");
    await expect(row(page, "Bold").getByRole("alert")).toHaveText(/together with the key/);
    // A key that cannot be bound.
    await page.keyboard.press("ControlOrMeta+Enter");
    await expect(row(page, "Bold").getByRole("alert")).toHaveText(/cannot be used/);
    await page.keyboard.press("Escape");
    await expect(row(page, "Bold").getByRole("alert")).toHaveCount(0);
    await expect(keycaps(page, "Bold", BOLD)).toBeVisible();

    await change(page, "Bold").click();
    await page.keyboard.press("Backspace");
    await expect(row(page, "Bold")).toContainText("No key");
    expect(await storedOverrides(page)).toEqual({ "editor.bold": null });
    await page.getByRole("button", { name: "Reset all" }).click();
    await expect(keycaps(page, "Bold", BOLD)).toBeVisible();
    await expect(page.getByRole("button", { name: "Reset all" })).toBeDisabled();
  });

  test("fixed keys have no Change button, and a freed key can be taken by another action", async ({
    page,
  }) => {
    await openShortcuts(page);
    await expect(row(page, "Copy").getByRole("button")).toHaveCount(0);
    await expect(row(page, "Leave Focus Mode").getByRole("button")).toHaveCount(0);
    await change(page, "Italic").click();
    await page.keyboard.press("ControlOrMeta+Alt+k");
    await change(page, "Bold").click();
    await page.keyboard.press("ControlOrMeta+i");
    await expect(keycaps(page, "Bold", /^(Control|Command) I$/)).toBeVisible();
  });
});

test.describe("screen reader announcements and focus", () => {
  const live = (page: Page) => page.locator("#shortcuts-live");

  test("recording, saving, conflict and cancel are announced", async ({ page }) => {
    await openShortcuts(page);
    await change(page, "Bold").click();
    await expect(live(page)).toHaveText("Press the new keys for Bold. Esc cancels.");
    await expect(row(page, "Bold")).toContainText("Press the new keys…");
    await page.keyboard.press("ControlOrMeta+i");
    // The conflict is announced by the visible alert.
    await expect(row(page, "Bold").getByRole("alert")).toHaveText(/Already used by “Italic”/);
    await page.keyboard.press("Escape");
    await expect(live(page)).toHaveText("Cancelled. Shortcut for Bold unchanged.");
    await change(page, "Bold").click();
    await page.keyboard.press("ControlOrMeta+Alt+j");
    await expect(live(page)).toHaveText("Shortcut for Bold saved.");
    await change(page, "Bold").click();
    await page.keyboard.press("Backspace");
    await expect(live(page)).toHaveText("Shortcut for Bold removed.");
  });

  test("Reset keeps focus on the Change button and says so", async ({ page }) => {
    await openShortcuts(page);
    await change(page, "Bold").click();
    await page.keyboard.press("ControlOrMeta+Alt+j");
    const reset = page.getByRole("button", { name: "Reset shortcut for Bold" });
    await reset.focus();
    await page.keyboard.press("Enter");
    await expect(reset).toHaveCount(0);
    await expect(change(page, "Bold")).toBeFocused();
    await expect(live(page)).toHaveText("Reset to default");
  });
});
