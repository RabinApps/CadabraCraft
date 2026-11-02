import type { Locator, Page } from "@playwright/test";
import { expect, test } from "./support/coverage";
import { fakeTauri } from "./support/fakeTauri";
import { fakeImportSources } from "./support/fakeImport";
import { addPage, newProject, safariMac, SHIFT_TAB, TAB } from "./support/helpers";

// Keyboard-only sweep of every dialog the fake backend can open (docs/platform-checks.md, "Accessibility passes"):
// focus never leaves the dialog while Tab and Shift+Tab cycle, Escape closes it, and focus goes back to where it was.

test.beforeEach(async ({ page }) => {
  await fakeTauri(page);
});

const toolbarButton = (page: Page, name: string) =>
  page.getByRole("toolbar", { name: "Formatting" }).getByRole("button", { name, exact: true });

interface Case {
  name: string;
  dialog: string | RegExp;
  /** Start state, then open the dialog. Returns the element that must have focus again once it is closed. */
  open: (page: Page) => Promise<Locator>;
}

const cases: Case[] = [
  {
    name: "New book",
    dialog: "New book",
    open: async (page) => {
      await page.goto("/");
      const opener = page.getByRole("button", { name: "New project" });
      await opener.focus();
      await page.keyboard.press("Enter");
      return opener;
    },
  },
  {
    name: "Import a manuscript",
    dialog: "Import a manuscript",
    open: async (page) => {
      await fakeImportSources(page, "md");
      await page.goto("/");
      const opener = page.getByRole("button", { name: "Import…" });
      await opener.focus();
      await page.keyboard.press("Enter");
      return opener;
    },
  },
  {
    name: "Export book",
    dialog: "Export book",
    open: async (page) => {
      await newProject(page);
      const opener = page.getByRole("button", { name: "Export", exact: true });
      await opener.focus();
      await page.keyboard.press("Enter");
      return opener;
    },
  },
  {
    name: "Book details",
    dialog: "Book details",
    open: async (page) => {
      await newProject(page);
      const opener = page.getByRole("button", { name: "Book details" }).first();
      await opener.focus();
      await page.keyboard.press("Enter");
      return opener;
    },
  },
  {
    name: "History of a chapter",
    dialog: "History · Chapter One",
    open: async (page) => {
      await newProject(page);
      const actions = page.getByRole("button", { name: "Actions for Chapter One" });
      await actions.focus();
      await page.keyboard.press("Enter");
      await page.getByRole("menuitem", { name: "History" }).focus();
      await page.keyboard.press("Enter");
      return actions;
    },
  },
  {
    name: "Move to trash confirmation",
    dialog: /^Move “Chapter One” to trash\?$/,
    open: async (page) => {
      await newProject(page);
      const actions = page.getByRole("button", { name: "Actions for Chapter One" });
      await actions.focus();
      await page.keyboard.press("Enter");
      await page.getByRole("menuitem", { name: "Move to trash" }).focus();
      await page.keyboard.press("Enter");
      return actions;
    },
  },
  {
    name: "Trash",
    dialog: "Trash",
    open: async (page) => {
      await newProject(page);
      const opener = page.getByRole("button", { name: "Trash", exact: true });
      await opener.focus();
      await page.keyboard.press("Enter");
      return opener;
    },
  },
  {
    name: "Book snapshots",
    dialog: /Book snapshots|History · Whole book/,
    open: async (page) => {
      await newProject(page);
      const opener = page.getByRole("button", { name: "Book snapshots" });
      await opener.focus();
      await page.keyboard.press("Enter");
      return opener;
    },
  },
  {
    name: "Add language",
    dialog: "Add language",
    open: async (page) => {
      await newProject(page);
      const opener = page.getByRole("button", { name: /^Edition:/ });
      await opener.focus();
      await page.keyboard.press("Enter");
      await page.getByRole("menuitem", { name: "Add language" }).focus();
      await page.keyboard.press("Enter");
      return opener;
    },
  },
  {
    name: "Command palette",
    dialog: "Command palette",
    open: async (page) => {
      await newProject(page);
      const opener = page.getByRole("button", { name: "Command palette" }).first();
      await opener.focus();
      await page.keyboard.press("Enter");
      return opener;
    },
  },
  {
    name: "Outline",
    dialog: "Outline",
    open: async (page) => {
      await newProject(page);
      const opener = page.getByRole("button", { name: "Outline", exact: true });
      await opener.focus();
      await page.keyboard.press("Enter");
      return opener;
    },
  },
  {
    name: "Add image",
    dialog: "Add image",
    open: async (page) => {
      await newProject(page);
      await page.locator(".ProseMirror p").last().click();
      await toolbarButton(page, "Image").focus();
      await page.keyboard.press("Enter");
      return toolbarButton(page, "Image");
    },
  },
  {
    name: "Add link",
    dialog: "Add link",
    open: async (page) => {
      await newProject(page);
      await page.locator(".ProseMirror p").last().click();
      await toolbarButton(page, "Link").focus();
      await page.keyboard.press("Enter");
      return toolbarButton(page, "Link");
    },
  },
  {
    name: "Add custom entry",
    dialog: "Add custom entry",
    open: async (page) => {
      await newProject(page);
      await addPage(page, "Contents");
      const opener = page.getByRole("button", { name: "Add custom entry" });
      await opener.focus();
      await page.keyboard.press("Enter");
      return opener;
    },
  },
  {
    name: "Reset the contents to the outline",
    dialog: "Reset the contents to the outline?",
    open: async (page) => {
      await newProject(page);
      await addPage(page, "Contents");
      const actions = page
        .getByRole("region", { name: "Contents", exact: true })
        .getByRole("button", { name: "Actions for Chapter One" });
      await actions.focus();
      await page.keyboard.press("Enter");
      await page.getByRole("menuitem", { name: "Hide from contents" }).focus();
      await page.keyboard.press("Enter");
      const opener = page.getByRole("button", { name: "Reset to outline" });
      await opener.focus();
      await page.keyboard.press("Enter");
      return opener;
    },
  },
];

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type=hidden]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

for (const c of cases) {
  test(`keyboard only: ${c.name} keeps focus inside, closes with Escape and returns focus`, async ({
    page,
  }) => {
    const back = await c.open(page);
    const dialog = page.getByRole("dialog", { name: c.dialog });
    await expect(dialog).toBeVisible();
    await page.evaluate(() =>
      Promise.all(document.getAnimations().map((a) => a.finished.catch(() => {}))),
    );
    // Focus moved into the dialog by itself.
    await expect.poll(() => dialog.evaluate((d) => d.contains(document.activeElement))).toBe(true);
    const stops = await dialog.locator(FOCUSABLE).count();
    const seen = new Set<string>();
    const mark = () =>
      page.evaluate(() => {
        const el = document.activeElement;
        const inside = !!el?.closest("[role=dialog]");
        const name = el
          ? `${el.tagName}|${el.getAttribute("aria-label") ?? el.textContent?.slice(0, 20) ?? ""}|${(el as HTMLInputElement).id}`
          : "";
        return { inside, name };
      });
    // Radix's focus trap wraps plain Tab only and ignores Alt+Tab, the only way to reach buttons in Playwright's WebKit
    // on macOS, so the wrap is checked on the other engines (Linux WebKit in CI included).
    for (const key of safariMac ? [] : [TAB, SHIFT_TAB]) {
      for (let i = 0; i < stops + 3; i++) {
        await page.keyboard.press(key);
        const at = await mark();
        expect(at.inside, `${key} #${i + 1} left the dialog: ${at.name}`).toBe(true);
        seen.add(at.name);
      }
    }
    // The pickers have one stop (the search field; the rows are reached with the arrow keys).
    if (!safariMac) expect(seen.size).toBeGreaterThanOrEqual(1);
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(back).toBeFocused();
  });
}

test("keyboard only: the Image details dialog opens from the toolbar and closes with Escape", async ({
  page,
}) => {
  await newProject(page);
  await page.locator(".ProseMirror p").last().click();
  await toolbarButton(page, "Image").click();
  await page
    .getByRole("dialog", { name: "Add image" })
    .getByLabel("Description (alt text)")
    .fill("x");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.locator(".ProseMirror figure img")).toBeVisible();
  // The selected picture enables "Image details".
  await page.locator(".ProseMirror figure img").click();
  const details = toolbarButton(page, "Image details");
  await expect(details).toBeEnabled();
  await details.focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: "Image details" });
  await expect(dialog).toBeVisible();
  // Decorative turns the description off, the checkbox stays reachable and toggles with Space.
  const box = dialog.getByRole("checkbox", { name: "This image is decorative" });
  await box.focus();
  await page.keyboard.press("Space");
  await expect(box).toBeChecked();
  await expect(dialog.getByLabel("Description (alt text)")).toBeDisabled();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("keyboard only: the settings screen has no focus trap and no lost focus", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Settings" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "Settings", level: 1 })).toBeVisible();
  const lost: string[] = [];
  for (let i = 0; i < 60; i++) {
    await page.keyboard.press(TAB);
    const onBody = await page.evaluate(() => document.activeElement === document.body);
    if (onBody) lost.push(`Tab #${i + 1}`);
  }
  // Tab wraps through the browser chrome once at most; it must not drop to the page body in the middle of the screen.
  expect(lost.length).toBeLessThanOrEqual(1);
});

// Focus after the Contents page changes the control that had it (WCAG 2.4.3 Focus Order): it goes to a control that is
// still there, never to the page body.
test.describe("contents: focus is never lost", () => {
  const contents = (page: Page) => page.getByRole("region", { name: "Contents", exact: true });
  const actions = (page: Page, title: string) =>
    contents(page).getByRole("button", { name: `Actions for ${title}`, exact: true });
  const reachMenuItem = async (page: Page, title: string, item: string) => {
    await actions(page, title).focus();
    await page.keyboard.press("Enter");
    await page.getByRole("menuitem", { name: item }).focus();
    await page.keyboard.press("Enter");
  };
  async function open(page: Page) {
    await newProject(page);
    await page.getByRole("button", { name: "Add chapter" }).click();
    await addPage(page, "Contents");
    await expect(contents(page)).toBeVisible();
    await expect(actions(page, "Chapter 2")).toBeVisible();
  }

  test("renaming ends with focus on the row's Actions button, after Enter and after Escape", async ({
    page,
  }) => {
    await open(page);
    await reachMenuItem(page, "Chapter 2", "Rename");
    const field = contents(page).getByRole("textbox", { name: "Entry title" });
    await expect(field).toBeFocused();
    await field.fill("Second");
    await page.keyboard.press("Enter");
    await expect(actions(page, "Second")).toBeFocused();
    await reachMenuItem(page, "Second", "Rename");
    await contents(page).getByRole("textbox", { name: "Entry title" }).fill("Nope");
    await page.keyboard.press("Escape");
    await expect(actions(page, "Second")).toBeFocused();
  });

  test("removing a custom entry moves focus to the next row; resetting keeps it on Reset to outline", async ({
    page,
  }) => {
    await open(page);
    const add = contents(page).getByRole("button", { name: "Add custom entry" });
    await add.focus();
    await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog", { name: "Add custom entry" });
    await dialog.getByLabel("Entry title").fill("Afterword");
    await page.keyboard.press("Enter");
    await expect(dialog).toHaveCount(0);
    await expect(add).toBeFocused();
    await reachMenuItem(page, "Afterword", "Remove entry");
    await expect(contents(page).getByRole("listitem").filter({ hasText: "Afterword" })).toHaveCount(
      0,
    );
    // It was the last row: focus goes to the row before it.
    await expect(actions(page, "Chapter 2")).toBeFocused();
    // Resetting leaves nothing to reset; the button stays focused (and says it is unavailable) instead of dropping focus.
    await reachMenuItem(page, "Chapter 2", "Hide from contents");
    const reset = contents(page).getByRole("button", { name: "Reset to outline" });
    await reset.focus();
    await page.keyboard.press("Enter");
    const confirm = page.getByRole("dialog", { name: "Reset the contents to the outline?" });
    await confirm.getByRole("button", { name: "Reset to outline" }).focus();
    await page.keyboard.press("Enter");
    await expect(confirm).toHaveCount(0);
    await expect(reset).toBeDisabled();
    await expect(reset).toBeFocused();
  });

  test("choosing the Preview pane keeps focus on the Preview choice", async ({ page }) => {
    await open(page);
    await page.setViewportSize({ width: 800, height: 800 });
    const view = contents(page).getByRole("radiogroup", { name: "Contents view" });
    await view.getByRole("radio", { name: "Preview" }).focus();
    await page.keyboard.press("Space");
    await expect(page.getByRole("region", { name: "Preview", exact: true })).toBeVisible();
    await expect(view.getByRole("radio", { name: "Preview" })).toBeFocused();
    await expect(view.getByRole("radio", { name: "Preview" })).toBeChecked();
    await view.getByRole("radio", { name: "Edit" }).click();
    await expect(view.getByRole("radio", { name: "Edit" })).toBeFocused();
  });
});
