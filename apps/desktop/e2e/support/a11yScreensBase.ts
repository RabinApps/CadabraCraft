import { expect } from "@playwright/test";
import { fakeImportSources } from "./fakeImport";
import { addPage, newProject, noVoices, seedSnapshot } from "./helpers";
import {
  toolbar,
  dialogOf,
  shown,
  menu,
  command,
  home,
  library,
  libraryList,
  settings,
  exportPanel,
  chapterMenu,
  lastParagraph,
  contentsRegion,
  preview,
  typstPages,
  contentsPage,
  contentsMenu,
  type Screen,
} from "./a11yScreenHelpers";

/** Every screen, dialog and panel the fake backend can reach. */
export const baseScreens: Screen[] = [
  { name: "home", open: home },
  {
    name: "part page with its chapter group in the sidebar",
    open: async (p) => {
      await newProject(p);
      await p.getByRole("button", { name: "Add part" }).click();
      await shown(
        p.getByRole("navigation", { name: "Chapters" }).getByRole("button", { name: /^Part 1/ }),
      );
    },
  },
  { name: "library", open: library },
  { name: "library, list layout with a missing folder", open: libraryList },
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
  {
    name: "Import into book preview with destination and split menu",
    open: async (p) => {
      await fakeImportSources(p, "sections", false);
      await newProject(p);
      await menu(p, "file.importInto");
      const dialog = dialogOf(p, "Import into this book");
      await dialog.getByRole("button", { name: "Choose file…" }).click();
      await dialog.getByRole("button", { name: "Next" }).click();
      await dialog.getByRole("button", { name: "Split chapter 1 at a heading" }).click();
      await shown(p.getByRole("menuitem", { name: "Alpha" }));
    },
  },
  {
    name: "Import outline preview dialog",
    open: async (p) => {
      await fakeImportSources(p, "outlineMd", false);
      await newProject(p);
      await menu(p, "file.importInto");
      const dialog = dialogOf(p, "Import into this book");
      await dialog.getByRole("button", { name: "Choose file…" }).click();
      await dialog.getByRole("button", { name: "Next" }).click();
      await dialog.getByRole("radio", { name: "Outline" }).click();
      await shown(dialog.getByText("2 chapters and 3 scenes will be imported."));
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
    name: "matter page actions menu (Vertical position)",
    open: async (p) => {
      await newProject(p);
      await addPage(p, "Title page");
      await p.getByRole("button", { name: "Actions for Title Page" }).click();
      await shown(p.getByRole("group", { name: "Vertical position" }));
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
    name: "chapter icon picker",
    open: async (p) => {
      await chapterMenu("Change icon…")(p);
      await shown(dialogOf(p, "Icon for “Chapter One”"));
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
      await toolbar(p, "More formatting").click();
      await p.getByRole("menuitem", { name: "Image details" }).click();
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
  {
    name: "editor with typewriter scrolling on (end slack)",
    open: async (p) => {
      await newProject(p);
      await menu(p, "view.typewriter");
      await expect(p.getByTestId("page-scroll")).toHaveCSS("padding-bottom", /^[1-9]\d{2,}/);
    },
  },
  { name: "Contents editor", open: contentsPage },
  {
    name: "Contents editor, renaming an entry",
    open: async (p) => {
      await contentsMenu(p);
      await p.getByRole("menuitem", { name: "Rename" }).click();
      await shown(contentsRegion(p).getByRole("textbox", { name: "Entry title" }));
    },
  },
  {
    name: "Contents row actions menu",
    open: async (p) => {
      await contentsMenu(p);
      await shown(p.getByRole("menuitem", { name: "Rename" }));
    },
  },
  {
    name: "Add custom entry dialog",
    open: async (p) => {
      await contentsPage(p);
      await contentsRegion(p).getByRole("button", { name: "Add custom entry" }).click();
      await shown(dialogOf(p, "Add custom entry"));
    },
  },
  {
    name: "Reset to outline confirmation",
    open: async (p) => {
      await contentsMenu(p);
      await p.getByRole("menuitem", { name: "Hide from contents" }).click();
      await contentsRegion(p).getByRole("button", { name: "Reset to outline" }).click();
      await shown(dialogOf(p, "Reset the contents to the outline?"));
    },
  },
  {
    name: "Contents preview (Typst pages)",
    open: async (p) => {
      await contentsPage(p, typstPages);
      await shown(preview(p));
      await expect(preview(p).locator("canvas").first()).toBeVisible({ timeout: 15_000 });
    },
  },
  {
    name: "Contents preview (approximation, Typst missing)",
    open: async (p) => {
      await contentsPage(p, (q) =>
        q.evaluate(() => {
          window.__typstError = { kind: "not_found", message: "The typst program was not found." };
        }),
      );
      await shown(preview(p));
      await expect(p.getByTestId("toc-preview-page").first()).toBeVisible({ timeout: 15_000 });
    },
  },
  {
    name: "Contents preview alone (narrow window)",
    open: async (p) => {
      await p.addInitScript(() =>
        localStorage.setItem("cadabracraft.tocPane", JSON.stringify({ pane: "preview" })),
      );
      await contentsPage(p, typstPages);
      await p.setViewportSize({ width: 800, height: 700 });
      await shown(preview(p));
      await expect(preview(p).locator("canvas").first()).toBeVisible({ timeout: 15_000 });
    },
  },
];
