import { expect, type Locator, type Page } from "@playwright/test";
import { addPage, newProject } from "./helpers";

/** A screen or dialog the accessibility specs audit: its name and how to reach it from a blank page. */
export type Screen = {
  name: string;
  open: (page: Page) => Promise<void>;
  /** The screen has no controls with a visible word (so the label-in-name audit has nothing to check). */
  noText?: true;
};

export const toolbar = (page: Page, name: string) =>
  page.getByRole("toolbar", { name: "Formatting" }).getByRole("button", { name, exact: true });
export const dialogOf = (page: Page, name: string | RegExp) => page.getByRole("dialog", { name });
export const shown = (l: Locator) => expect(l).toBeVisible();

/** Runs a menu command by id (the same entry point the native menu uses). */
export const menu = async (page: Page, id: string) => {
  // The bridge is installed when the app mounts; under load a screen can be asked for before that.
  await page.waitForFunction(() => "__cadabraMenu" in window);
  await page.evaluate(
    (c) =>
      (window as never as { __cadabraMenu: { run: (id: string) => void } }).__cadabraMenu.run(c),
    id,
  );
};
export const command = (page: Page, id: string) =>
  page.evaluate(async (c) => {
    (await import("/src/state/commands.ts" as string)).runCommand(c);
  }, id);

export const home = async (page: Page) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
};
/** Five known books (one series of two, one whose folder is gone), then the Library open. */
export const shelf = (page: Page) =>
  page.addInitScript(() => {
    const at = Date.now();
    localStorage.setItem(
      "cadabracraft.recents",
      JSON.stringify([
        {
          root: "/b/salt",
          title: "The Salt Orchard",
          openedAt: at,
          editedAt: at,
          stats: {
            author: "Mara Quill",
            chapters: 12,
            words: 48210,
            chapterNo: 1,
            chapterTitle: "One",
            series: "The Orchard Cycle",
            seriesNumber: "1",
          },
        },
        {
          root: "/b/glass",
          title: "The Glass Orchard",
          openedAt: at - 1000,
          stats: {
            author: "Mara Quill",
            chapters: 9,
            words: 31480,
            chapterNo: 1,
            chapterTitle: "One",
            series: "The Orchard Cycle",
            seriesNumber: "2",
          },
        },
        { root: "/gone", title: "Moved Book", openedAt: at - 2000 },
        {
          root: "/b/new",
          title: "Found In A Scan",
          openedAt: 0,
          scanned: { author: "Pat Writer" },
        },
      ]),
    );
  });
export const library = async (page: Page) => {
  await shelf(page);
  await page.goto("/");
  await page.getByRole("button", { name: /^View all books/ }).click();
  await shown(page.getByRole("heading", { name: "Library", level: 1 }));
};
export const libraryList = async (page: Page) => {
  await library(page);
  await page.getByRole("radio", { name: "List" }).click();
  await page.getByRole("button", { name: /^Moved Book/ }).click();
  await shown(page.getByText("Folder not found."));
};
export const settings = async (page: Page) => {
  await home(page);
  await page.getByRole("button", { name: "Settings" }).click();
  await shown(page.getByRole("heading", { name: "Settings", level: 1 }));
};
export const exportPanel = (radio: string | RegExp) => async (page: Page) => {
  await newProject(page);
  await page.getByRole("button", { name: "Export", exact: true }).click();
  const dialog = dialogOf(page, "Export book");
  await dialog.getByRole("radio", { name: radio }).click();
  await shown(dialog);
};
export const chapterMenu = (item: string) => async (page: Page) => {
  await newProject(page);
  await page.getByRole("button", { name: "Actions for Chapter One" }).click();
  await page.getByRole("menuitem", { name: item }).click();
};
export const lastParagraph = async (page: Page) => {
  await newProject(page);
  await page.locator(".ProseMirror p").last().click();
};

/** The scene board of a book whose first chapter holds a scene (added from the sidebar, with some text in it). */
export const sceneBoard = async (page: Page) => {
  await newProject(page);
  await page
    .getByRole("list", { name: "Scenes in Chapter One" })
    .getByRole("button", { name: "Scene", exact: true })
    .click();
  await page.keyboard.type("Mara waits on the quay.");
  await expect(page.getByRole("status").first()).toContainText("Saved");
  await page.getByRole("button", { name: "Scene board" }).click();
  await shown(page.getByRole("heading", { name: "Scene board", level: 1 }));
  await shown(page.getByRole("button", { name: "Add a synopsis to Untitled scene" }));
};

/** The timeline of a book whose first chapter holds a dated scene and an undated one. */
export const timeline = async (page: Page) => {
  await newProject(page);
  const add = () =>
    page
      .getByRole("list", { name: "Scenes in Chapter One" })
      .getByRole("button", { name: "Scene", exact: true })
      .click();
  await add();
  await page.keyboard.type("Mara waits on the quay.");
  await expect(page.getByRole("status").first()).toContainText("Saved");
  await page.getByRole("button", { name: "Timeline" }).click();
  await shown(page.getByRole("heading", { name: "Timeline", level: 1 }));
  const day = page.getByLabel("Story date of Untitled scene", { exact: true });
  await shown(day);
  await day.fill("1893-09-03");
  await day.blur();
  await shown(page.getByRole("button", { name: "Clear the story date of Untitled scene" }));
};

export const contentsRegion = (page: Page) =>
  page.getByRole("region", { name: "Contents", exact: true });
export const preview = (page: Page) => page.getByRole("region", { name: "Preview", exact: true });
/** Typst's page report puts the contents page on pages 2 and 3 of 6 (the fake PDF has blank pages). Set before the page is added. */
export const typstPages = (page: Page) =>
  page.evaluate(() => {
    window.__typstPages = 6;
    window.__typstQueryResultFor = (source: string) => {
      const id = /#contents-page\("([^"]+)"/.exec(source)?.[1];
      return id
        ? JSON.stringify({
            total: 6,
            starts: [{ id, kind: "contents", page: 2, end: 3, number: "ii" }],
          })
        : undefined;
    };
  });
/** A book with its Contents page open (the list is generated from the chapters). */
export const contentsPage = async (page: Page, before?: (page: Page) => Promise<unknown>) => {
  await newProject(page);
  await before?.(page);
  await addPage(page, "Contents");
  await shown(contentsRegion(page));
};
export const contentsMenu = async (page: Page) => {
  await contentsPage(page);
  await contentsRegion(page).getByRole("button", { name: "Actions for Chapter One" }).click();
};
