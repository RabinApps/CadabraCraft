import { expect, type Page } from "@playwright/test";
import { chapterDoc, newProject, seedChapters } from "../../e2e/support/helpers";
import { bareRole, type Area } from "../support";

const SETTLE_MS = 3000;

const openSettings = async (page: Page) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Settings" }).click();
  await expect(page.getByRole("heading", { name: "Settings", level: 1 })).toBeVisible();
};

export const settingsScreen: Area = {
  name: "settings: headings, theme, language and switches",
  run: async ({ page, enter, walk }) => {
    await openSettings(page);
    await enter();

    // Top of the screen: back button, the level-1 heading, the section nav, then Appearance and General.
    const said = await walk("next", 42, /Check for updates on launch/);
    const text = said.join("\n");
    expect(text).toMatch(/heading.*Settings|Settings.*heading/i);
    expect(text).toMatch(/Appearance/);
    expect(text).toMatch(/General/);
    // The Theme radio group: each radio is named and its state is spoken.
    expect(text).toMatch(/System/);
    expect(text).toMatch(/Light/);
    expect(text).toMatch(/Dark/);
    expect(text).toMatch(/radio/i);
    // The interface language select is named (macOS says pop up button for a select).
    expect(text).toMatch(/Interface language/);
    expect(text).toMatch(/pop up button|combo ?box/i);
    // A switch is announced with its name and its state (on for "Check for updates on launch").
    const updates = said.find((l) => /Check for updates on launch/.test(l));
    expect(updates, `no phrase named the updates switch:\n${text}`).toBeDefined();
    expect(updates).toMatch(/switch/i);
    expect(updates).toMatch(/\b(on|1|checked)\b/i);
    expect(bareRole(said)).toEqual([]);
  },
};

export const settingsShortcuts: Area = {
  name: "settings: the shortcut search field and switches in Editor",
  run: async ({ page, enter, walk, cap, vo }) => {
    await openSettings(page);
    await enter();
    // The Editor section starts about 25 items down; the walk stops at the Typewriter switch.
    const said = await walk(
      "next",
      40,
      /Typewriter scrolling.*switch|switch.*Typewriter scrolling/i,
    );
    const typewriter = said.at(-1) ?? "";
    expect(typewriter, `never reached the Typewriter switch:\n${said.join("\n")}`).toMatch(
      /Typewriter scrolling/,
    );
    expect(typewriter).toMatch(/switch/i);
    // It is off by default.
    expect(typewriter).toMatch(/\b(off|0|unchecked)\b/i);
    expect(bareRole(said)).toEqual([]);

    // The shortcut search field is far down the page: move keyboard focus to it and hear VoiceOver follow. The phrase
    // right after the focus change, or a step either way, must name the field.
    await page.locator("#shortcuts").getByRole("searchbox", { name: "Search shortcuts" }).focus();
    await page.waitForTimeout(SETTLE_MS);
    const heard = [await cap("lastSpokenPhrase", vo.lastSpokenPhrase())];
    heard.push(...(await walk("next", 1)));
    heard.push(...(await walk("previous", 2)));
    const joined = heard.join("\n");
    expect(joined, "VoiceOver did not name the shortcut search field").toMatch(/Search shortcuts/);
    expect(bareRole(heard)).toEqual([]);
  },
};

export const skipLink: Area = {
  name: "skip link is the first stop and moves to main",
  run: async ({ page, enter, walk, cap, vo }) => {
    await page.goto("/");
    await expect(page.getByRole("button", { name: "New project" })).toBeVisible();
    await enter();

    // The skip link is the first item. Back up to it in case entering landed on the second one.
    const first = await cap("lastSpokenPhrase", vo.lastSpokenPhrase());
    if (!/Skip to main content/i.test(first)) {
      const back = await walk("previous", 4, /Skip to main content/i);
      expect(back.join("\n"), "Skip to main content is not the first item").toMatch(
        /Skip to main content/i,
      );
    }
    await cap("act", vo.act());
    await page.waitForTimeout(1000);
    await expect.poll(() => page.evaluate(() => document.activeElement?.id)).toBe("main");

    // VoiceOver continues in the main content, not in the header.
    const after = await walk("next", 4);
    expect(after.join("\n")).toMatch(/Write your first book|New project|Open folder|Import/);
    expect(after.join("\n")).not.toMatch(/Settings/);
  },
};

export const commandPalette: Area = {
  name: "command palette opened by its shortcut",
  run: async ({ page, enter, walk }) => {
    await newProject(page);
    await enter();

    await page.getByRole("button", { name: "Command palette" }).click();
    const box = page.getByRole("combobox", { name: "Command palette" });
    await expect(box).toBeFocused();
    await page.waitForTimeout(SETTLE_MS);

    // The search field carries the name "Command palette" and a text-field role.
    const heard = [...(await walk("previous", 4, /Command palette/)), ...(await walk("next", 6))];
    const text = heard.join("\n");
    expect(text).toMatch(/Command palette/);
    expect(text).toMatch(/combo ?box|text field|search|edit text/i);
    expect(bareRole(heard)).toEqual([]);

    // Typing filters the list; the match is a named option in the listbox.
    await page.keyboard.type("bold");
    await expect(
      page.getByRole("listbox", { name: "Command palette" }).getByRole("option", { name: /Bold/ }),
    ).toBeVisible();
    await page.waitForTimeout(1000);
    const filtered = await walk("next", 4);
    expect(bareRole(filtered)).toEqual([]);

    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog", { name: "Command palette" })).toHaveCount(0);
  },
};

export const outlineNavigator: Area = {
  name: "outline navigator opened by its shortcut",
  run: async ({ page, enter, walk }) => {
    await newProject(page);
    await seedChapters(page, [chapterDoc("Chapter One", 3), chapterDoc("Second Part", 2)]);
    await enter();

    await page.getByRole("button", { name: "Outline", exact: true }).click();
    await expect(page.getByRole("combobox", { name: "Outline" })).toBeFocused();
    await page.waitForTimeout(SETTLE_MS);

    // VoiceOver starts on the list; the dialog's name is above it, so the lists' own headings are the sure signal.
    const heard = [...(await walk("previous", 3)), ...(await walk("next", 8))];
    expect(heard.join("\n")).toMatch(/Outline|IN THIS CHAPTER/);
    expect(heard.join("\n")).toMatch(/Second Part/);
    expect(bareRole(heard)).toEqual([]);

    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog", { name: "Outline" })).toHaveCount(0);
  },
};

export const chapterMenu: Area = {
  name: "chapter actions menu",
  run: async ({ page, enter, walk }) => {
    await newProject(page);
    await enter();

    await page.getByRole("button", { name: "Actions for Chapter One" }).click();
    const menu = page.getByRole("menu", { name: "Actions for Chapter One" });
    await expect(menu).toBeVisible();
    await page.waitForTimeout(SETTLE_MS);

    // VoiceOver can start on any item; go back to the top of the menu, then walk down.
    const heard = [
      ...(await walk("previous", 8, /Rename/)),
      ...(await walk("next", 8, /Move to trash/)),
    ];
    const text = heard.join("\n");
    expect(text).toMatch(/Rename/);
    expect(text).toMatch(/History/);
    expect(text).toMatch(/Move to trash/);
    expect(text).toMatch(/menu item|menu/i);
    expect(bareRole(heard)).toEqual([]);

    await page.keyboard.press("Escape");
    await expect(menu).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Actions for Chapter One" })).toBeFocused();
  },
};

export const printPreview: Area = {
  name: "print preview screen",
  run: async ({ page, enter, walk }) => {
    await newProject(page);
    await enter();

    // The preview opens from the Export dialog; the dialog closes as the screen takes over.
    await page.getByRole("button", { name: "Export", exact: true }).click();
    await page
      .getByRole("dialog", { name: "Export book" })
      .getByRole("button", { name: "Print preview" })
      .click();
    await expect(page.getByRole("heading", { name: "Print preview" })).toBeVisible();
    await page.waitForTimeout(SETTLE_MS);

    const heard = [...(await walk("previous", 4)), ...(await walk("next", 10))];
    const text = heard.join("\n");
    expect(text).toMatch(/Print preview/);
    expect(text).toMatch(/Back/);
    expect(bareRole(heard)).toEqual([]);
  },
};

export const recentProjects: Area = {
  name: "home project list with recent books",
  run: async ({ page, enter, walk, find }) => {
    await page.goto("/");
    const now = Date.now();
    await page.evaluate(
      (list) => localStorage.setItem("cadabracraft.recents", JSON.stringify(list)),
      [
        {
          root: "/proj",
          title: "The Salt Orchard",
          openedAt: now,
          editedAt: now,
          stats: {
            author: "Mara Quill",
            chapters: 12,
            words: 48210,
            chapterNo: 7,
            chapterTitle: "The Orchard Wall",
          },
        },
        { root: "/old", title: "Old Book", openedAt: now - 2 * 24 * 60 * 60 * 1000 },
      ],
    );
    try {
      await page.reload();
      await expect(page.getByRole("heading", { name: "Your books" })).toBeVisible();
      await enter();

      const toBook = await find(/The Salt Orchard/, 25);
      const toOld = await find(/Old Book/, 15);
      const rest = await walk("next", 3);
      const heard = [...toBook, ...toOld, ...rest];
      const text = heard.join("\n");
      expect(text).toMatch(/Mara Quill|12 chapters/);
      expect(text).toMatch(/Old Book/);
      expect(text).toMatch(/Remove .* from recent projects|Remove/);
      expect(bareRole(heard)).toEqual([]);
    } finally {
      await page.evaluate(() => localStorage.removeItem("cadabracraft.recents")).catch(() => {});
    }
  },
};

export const shell: Area[] = [
  settingsScreen,
  settingsShortcuts,
  skipLink,
  commandPalette,
  outlineNavigator,
  chapterMenu,
  printPreview,
  recentProjects,
];
