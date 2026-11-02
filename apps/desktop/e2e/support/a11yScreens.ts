import { expect, type Locator, type Page } from "@playwright/test";
import { fakeImportSources } from "./fakeImport";
import { newProject, noVoices, seedSnapshot } from "./helpers";

/** A screen or dialog the accessibility specs audit: its name and how to reach it from a blank page. */
export type Screen = {
  name: string;
  open: (page: Page) => Promise<void>;
  /** The screen has no controls with a visible word (so the label-in-name audit has nothing to check). */
  noText?: true;
};

const toolbar = (page: Page, name: string) =>
  page.getByRole("toolbar", { name: "Formatting" }).getByRole("button", { name, exact: true });
const dialogOf = (page: Page, name: string | RegExp) => page.getByRole("dialog", { name });
const shown = (l: Locator) => expect(l).toBeVisible();

/** Runs a menu command by id (the same entry point the native menu uses). */
const menu = (page: Page, id: string) =>
  page.evaluate(
    (c) =>
      (window as never as { __cadabraMenu: { run: (id: string) => void } }).__cadabraMenu.run(c),
    id,
  );
const command = (page: Page, id: string) =>
  page.evaluate(async (c) => {
    (await import("/src/state/commands.ts" as string)).runCommand(c);
  }, id);

const home = async (page: Page) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
};
const settings = async (page: Page) => {
  await home(page);
  await page.getByRole("button", { name: "Settings" }).click();
  await shown(page.getByRole("heading", { name: "Settings", level: 1 }));
};
const exportPanel = (radio: string | RegExp) => async (page: Page) => {
  await newProject(page);
  await page.getByRole("button", { name: "Export", exact: true }).click();
  const dialog = dialogOf(page, "Export book");
  await dialog.getByRole("radio", { name: radio }).click();
  await shown(dialog);
};
const chapterMenu = (item: string) => async (page: Page) => {
  await newProject(page);
  await page.getByRole("button", { name: "Actions for Chapter One" }).click();
  await page.getByRole("menuitem", { name: item }).click();
};
const lastParagraph = async (page: Page) => {
  await newProject(page);
  await page.locator(".ProseMirror p").last().click();
};

/** Every screen, dialog and panel the fake backend can reach. */
export const screens: Screen[] = [
  { name: "home", open: home },
  { name: "editor", open: newProject },
  {
    name: "New book dialog",
    open: async (p) => {
      await home(p);
      await p.getByRole("button", { name: "New project" }).click();
      await shown(dialogOf(p, "New book"));
    },
  },
  {
    name: "Import a manuscript dialog",
    open: async (p) => {
      await fakeImportSources(p, "md");
      await home(p);
      await p.getByRole("button", { name: "Import…" }).click();
      await shown(dialogOf(p, "Import a manuscript"));
    },
  },
  {
    name: "Import into book dialog",
    open: async (p) => {
      await newProject(p);
      await menu(p, "file.importInto");
      await shown(dialogOf(p, "Import into this book"));
    },
  },
  { name: "settings", open: settings },
  {
    name: "settings, Shortcuts section filtered",
    open: async (p) => {
      await settings(p);
      await p
        .locator("#shortcuts")
        .getByRole("searchbox", { name: "Search shortcuts" })
        .fill("bold");
      await shown(
        p
          .locator("#shortcuts")
          .getByRole("button", { name: /^Change shortcut for/ })
          .first(),
      );
    },
  },
  {
    name: "settings, Fonts section and Download fonts dialog",
    open: async (p) => {
      await settings(p);
      await p.getByRole("button", { name: "Browse fonts…" }).click();
      await shown(dialogOf(p, "Download fonts"));
    },
  },
  {
    name: "settings, Audio section without voices",
    open: async (p) => {
      await p.addInitScript(noVoices);
      await settings(p);
      await p.locator("#audio").scrollIntoViewIfNeeded();
      await shown(p.locator("#audio"));
    },
  },
  {
    name: "settings, Backups section",
    open: async (p) => {
      await settings(p);
      await p.locator("#backups").scrollIntoViewIfNeeded();
      await shown(p.locator("#backups"));
    },
  },
  { name: "export dialog", open: exportPanel("EPUB 3") },
  { name: "export dialog, PDF options", open: exportPanel("Print PDF") },
  { name: "export dialog, audiobook panel", open: exportPanel("Audiobook") },
  {
    name: "export dialog, audiobook panel without voices",
    open: async (p) => {
      await p.addInitScript(noVoices);
      await exportPanel("Audiobook")(p);
    },
  },
  {
    name: "print preview",
    open: async (p) => {
      await exportPanel("Print PDF")(p);
      await dialogOf(p, "Export book").getByRole("button", { name: "Print preview" }).click();
      await shown(p.getByRole("heading", { name: "Print preview" }));
    },
  },
  {
    name: "Book details dialog",
    open: async (p) => {
      await newProject(p);
      await p.getByRole("button", { name: "Book details" }).first().click();
      await shown(dialogOf(p, "Book details"));
    },
  },
  {
    name: "command palette",
    open: async (p) => {
      await newProject(p);
      await p.getByRole("button", { name: "Command palette" }).first().click();
      await shown(dialogOf(p, "Command palette"));
    },
  },
  {
    name: "chapter actions menu",
    open: async (p) => {
      await newProject(p);
      await p.getByRole("button", { name: "Actions for Chapter One" }).click();
      await shown(p.getByRole("menuitem").first());
    },
  },
  {
    name: "find bar",
    open: async (p) => {
      await newProject(p);
      await p.locator(".ProseMirror").click();
      await p.keyboard.press("ControlOrMeta+f");
      await shown(
        p
          .getByRole("search")
          .or(p.getByRole("textbox", { name: /find/i }))
          .first(),
      );
    },
  },
  {
    name: "chapter History dialog",
    open: async (p) => {
      await chapterMenu("History")(p);
      await shown(dialogOf(p, "History · Chapter One"));
    },
  },
  {
    name: "Move to trash confirmation",
    open: async (p) => {
      await chapterMenu("Move to trash")(p);
      await shown(dialogOf(p, /^Move “Chapter One” to trash\?$/));
    },
  },
  {
    name: "Trash dialog",
    open: async (p) => {
      await chapterMenu("Move to trash")(p);
      await dialogOf(p, /^Move “Chapter One” to trash\?$/)
        .getByRole("button", { name: "Move to trash" })
        .click();
      await p.getByRole("button", { name: "Trash", exact: true }).click();
      await shown(dialogOf(p, "Trash"));
    },
  },
  {
    name: "Book snapshots dialog",
    open: async (p) => {
      await newProject(p);
      await p.getByRole("button", { name: "Book snapshots" }).click();
      await shown(dialogOf(p, /Book snapshots|History · Whole book/));
    },
  },
  {
    name: "Recover newer text dialog",
    open: async (p) => {
      await newProject(p);
      const { file, path } = await seedSnapshot(p, "the newer text");
      await p.evaluate((x) => sessionStorage.setItem("stale", JSON.stringify([x])), {
        path: file,
        snapshot: path,
      });
      await p.reload();
      await p.getByRole("button", { name: "Open folder" }).click();
      await shown(dialogOf(p, /Recover newer text for/));
    },
  },
  {
    name: "Add language dialog",
    open: async (p) => {
      await newProject(p);
      await p.getByRole("button", { name: /^Edition:/ }).click();
      await p.getByRole("menuitem", { name: "Add language" }).click();
      await shown(dialogOf(p, "Add language"));
    },
  },
  {
    name: "Editions menu",
    open: async (p) => {
      await newProject(p);
      await p.getByRole("button", { name: /^Edition:/ }).click();
      await shown(p.getByRole("menuitem", { name: "Add language" }));
    },
  },
  {
    name: "Outline dialog",
    open: async (p) => {
      await newProject(p);
      await p.getByRole("button", { name: "Outline", exact: true }).click();
      await shown(dialogOf(p, "Outline"));
    },
  },
  {
    name: "References panel",
    open: async (p) => {
      await newProject(p);
      await p.getByRole("button", { name: "References", exact: true }).first().click();
      await shown(p.getByRole("region", { name: "References" }));
    },
  },
  {
    name: "Add image dialog",
    open: async (p) => {
      await lastParagraph(p);
      await toolbar(p, "Image").click();
      await shown(dialogOf(p, "Add image"));
    },
  },
  {
    name: "Image details dialog",
    open: async (p) => {
      await lastParagraph(p);
      await toolbar(p, "Image").click();
      await dialogOf(p, "Add image").getByLabel("Description (alt text)").fill("x");
      await p.keyboard.press("Enter");
      await p.locator(".ProseMirror figure img").click();
      await toolbar(p, "Image details").click();
      await shown(dialogOf(p, "Image details"));
    },
  },
  {
    name: "Add link dialog",
    open: async (p) => {
      await lastParagraph(p);
      await toolbar(p, "Link").click();
      await shown(dialogOf(p, "Add link"));
    },
  },
  {
    name: "Insert table dialog",
    open: async (p) => {
      await lastParagraph(p);
      await command(p, "editor.table");
      await shown(dialogOf(p, "Insert table"));
    },
  },
  {
    name: "Language of selection dialog",
    open: async (p) => {
      await lastParagraph(p);
      await p.keyboard.type("Bonjour");
      await p.keyboard.press("Shift+Home");
      await command(p, "editor.lang");
      await shown(dialogOf(p, "Language of selection"));
    },
  },
  {
    name: "Read mode",
    open: async (p) => {
      await newProject(p);
      await p.getByRole("radio", { name: "Read" }).click();
      await shown(p.getByTestId("reading-scroll"));
    },
  },
  {
    name: "Focus mode",
    noText: true,
    open: async (p) => {
      await newProject(p);
      await p.getByRole("button", { name: "Focus mode" }).click();
      await shown(p.getByRole("button", { name: "Exit focus mode" }));
    },
  },
];
