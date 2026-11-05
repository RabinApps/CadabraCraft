import { expect, type Locator, type Page } from "@playwright/test";
import { fakeImportSources } from "./fakeImport";
import { answer, covBackend, failOn } from "./cov";
import { addPage, newProject, noVoices, seedSnapshot } from "./helpers";

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
const menu = async (page: Page, id: string) => {
  // The bridge is installed when the app mounts; under load a screen can be asked for before that.
  await page.waitForFunction(() => "__cadabraMenu" in window);
  await page.evaluate(
    (c) =>
      (window as never as { __cadabraMenu: { run: (id: string) => void } }).__cadabraMenu.run(c),
    id,
  );
};
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

/** The scene board of a book whose first chapter holds a scene (added from the sidebar, with some text in it). */
const sceneBoard = async (page: Page) => {
  await newProject(page);
  await page
    .getByRole("list", { name: "Scenes in Chapter One" })
    .getByRole("button", { name: "Scene", exact: true })
    .click();
  await page.keyboard.type("Mara waits on the quay.");
  await expect(page.getByRole("status").first()).toContainText("Saved");
  await page.getByRole("button", { name: "Scene board" }).click();
  await shown(page.getByRole("heading", { name: "Scene board", level: 1 }));
  await shown(page.getByRole("button", { name: "Edit synopsis of Untitled scene" }));
};

const contentsRegion = (page: Page) => page.getByRole("region", { name: "Contents", exact: true });
const preview = (page: Page) => page.getByRole("region", { name: "Preview", exact: true });
/** Typst's page report puts the contents page on pages 2 and 3 of 6 (the fake PDF has blank pages). Set before the page is added. */
const typstPages = (page: Page) =>
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
const contentsPage = async (page: Page, before?: (page: Page) => Promise<unknown>) => {
  await newProject(page);
  await before?.(page);
  await addPage(page, "Contents");
  await shown(contentsRegion(page));
};
const contentsMenu = async (page: Page) => {
  await contentsPage(page);
  await contentsRegion(page).getByRole("button", { name: "Actions for Chapter One" }).click();
};

/** Every screen, dialog and panel the fake backend can reach. */
const baseScreens: Screen[] = [
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

const refBytes = (s: string) => Array.from(s, (c) => c.charCodeAt(0));
/** A book whose References panel lists one two-page PDF (the file picker is faked). */
const withReference = async (page: Page) => {
  await newProject(page);
  const pdf = refBytes(
    "%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R 4 0 R]/Count 2>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 100]>>endobj\n4 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 100]>>endobj\ntrailer<</Root 1 0 R/Size 5>>\n%%EOF",
  );
  await page.evaluate((contents) => {
    window.__pickedRefs = ["/tmp/notes.pdf"];
    window.__refFiles = { "/tmp/notes.pdf": contents };
  }, pdf);
  await page.getByRole("button", { name: "References", exact: true }).first().click();
  await page.getByRole("button", { name: "Add files" }).click();
  await shown(page.getByRole("region", { name: "References" }).locator("[data-open]").first());
};
const PIXEL =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
/** Starts an audiobook export with the default options (the fake engine renders at once unless `__audioHold` is set). */
const startAudiobook = async (page: Page, before?: () => Promise<unknown>) => {
  await newProject(page);
  await before?.();
  await page.getByRole("button", { name: "Export", exact: true }).click();
  const dialog = dialogOf(page, "Export book");
  await dialog.getByRole("radio", { name: "Audiobook" }).click();
  await dialog.getByRole("button", { name: "Export audiobook" }).click();
};
const snapshotsDialog = (page: Page) => dialogOf(page, /Book snapshots|History · Whole book/);
/** The whole-book History dialog with one snapshot taken and selected. */
const withSnapshot = async (page: Page) => {
  await newProject(page);
  await page.getByRole("button", { name: "Book snapshots" }).click();
  const dialog = snapshotsDialog(page);
  await dialog.getByLabel("Snapshot name").fill("Before the rewrite");
  await dialog.getByRole("button", { name: "Take snapshot" }).click();
  await shown(dialog.getByRole("list", { name: "Book snapshots" }));
  await dialog.getByRole("list", { name: "Book snapshots" }).getByRole("button").first().click();
};

/** Dialogs, panels and shell states added for the second accessibility sweep. */
export const moreScreens: Screen[] = [
  {
    name: "Read mode, Contents page",
    open: async (p) => {
      await contentsPage(p);
      await p.getByRole("radio", { name: "Read" }).click();
      await shown(p.getByTestId("reading-contents"));
      await shown(p.getByTestId("reading-contents").getByRole("link").first());
    },
  },
  {
    name: "editor toolbar, More formatting menu open",
    open: async (p) => {
      await lastParagraph(p);
      await toolbar(p, "More formatting").click();
      await shown(p.getByRole("menu", { name: "More formatting" }));
    },
  },
  {
    name: "editor toolbar, Text alignment menu open",
    open: async (p) => {
      await lastParagraph(p);
      await toolbar(p, "Text alignment").click();
      await shown(p.getByRole("menu", { name: "Text alignment" }));
    },
  },
  {
    name: "Templates panel",
    open: async (p) => {
      await newProject(p);
      await p.getByRole("button", { name: "Change template" }).click();
      await shown(p.getByRole("radiogroup", { name: "Big first letter" }));
    },
  },
  {
    name: "Scene board",
    open: async (p) => {
      await sceneBoard(p);
    },
  },
  {
    name: "Scene board, card menu open",
    open: async (p) => {
      await sceneBoard(p);
      await p.getByRole("button", { name: "Actions for Untitled scene" }).click();
      await shown(p.getByRole("menuitem", { name: "Move later" }));
    },
  },
  {
    name: "Licenses dialog",
    open: async (p) => {
      await home(p);
      await menu(p, "help.licenses");
      await shown(dialogOf(p, "Licenses"));
    },
  },
  {
    name: "Update available dialog",
    open: async (p) => {
      await covBackend(p);
      await newProject(p);
      await answer(p, "updates_supported", true);
      await answer(p, "plugin:updater|check", {
        rid: 7,
        currentVersion: "0.1.0",
        version: "0.2.0",
      });
      await menu(p, "help.updates");
      await shown(dialogOf(p, "Version 0.2.0 is available"));
    },
  },
  {
    name: "Sponsor dialog",
    open: async (p) => {
      await p.addInitScript(() => {
        sessionStorage.setItem("sponsorTest", "1");
        localStorage.removeItem("cadabracraft.sponsor");
      });
      await newProject(p);
      await p.getByRole("button", { name: "Export", exact: true }).click();
      await dialogOf(p, "Export book").getByRole("button", { name: "Export", exact: true }).click();
      await shown(dialogOf(p, "Enjoying CadabraCraft?"));
    },
  },
  { name: "export dialog, Markdown panel", open: exportPanel("Markdown") },
  { name: "export dialog, Word panel", open: exportPanel("Word (.docx)") },
  { name: "export dialog, Rich Text panel", open: exportPanel("Rich Text (.rtf)") },
  {
    name: "export dialog, PDF with bleed and crop marks",
    open: async (p) => {
      await exportPanel("Print PDF")(p);
      const dialog = dialogOf(p, "Export book");
      await dialog.getByLabel("Crop marks").check();
      await shown(dialog.getByLabel("Crop marks"));
    },
  },
  {
    name: "Book snapshots, one snapshot selected",
    open: async (p) => {
      await withSnapshot(p);
      await shown(snapshotsDialog(p).getByRole("button", { name: "Restore whole book" }));
    },
  },
  {
    name: "Restore the whole book confirmation",
    open: async (p) => {
      await withSnapshot(p);
      await snapshotsDialog(p).getByRole("button", { name: "Restore whole book" }).click();
      await shown(dialogOf(p, "Restore the whole book?"));
    },
  },
  {
    name: "Delete snapshot confirmation",
    open: async (p) => {
      await withSnapshot(p);
      await snapshotsDialog(p).getByRole("button", { name: "Delete snapshot" }).click();
      await shown(dialogOf(p, "Delete this snapshot?"));
    },
  },
  {
    name: "References panel with a PDF",
    open: withReference,
  },
  {
    name: "Reference viewer (PDF)",
    open: async (p) => {
      await withReference(p);
      await p.getByRole("region", { name: "References" }).locator("[data-open]").first().click();
      await expect(p.locator('canvas[aria-label^="PDF page"]')).toBeVisible({ timeout: 15_000 });
    },
  },
  {
    name: "editor with a notice in the header",
    open: async (p) => {
      await newProject(p);
      await p.evaluate(async () => {
        const { useProject } = await import("/src/state/project/index.ts" as string);
        useProject.setState({ notice: "Your last changes could not be saved (disk full)." });
      });
      await shown(p.getByRole("status").filter({ hasText: "disk full" }));
    },
  },
  {
    name: "header More actions menu (narrow window)",
    open: async (p) => {
      await newProject(p);
      await p.setViewportSize({ width: 500, height: 800 });
      await p.getByRole("button", { name: "More actions" }).click();
      await shown(p.getByRole("menuitem").first());
    },
  },
  {
    name: "chapter list drawer (tablet width)",
    open: async (p) => {
      await newProject(p);
      await p.setViewportSize({ width: 800, height: 900 });
      await p.getByRole("button", { name: "Show chapters" }).click();
      await shown(p.getByRole("navigation", { name: "Chapters" }));
    },
  },
  {
    name: "chapter list sheet (phone width)",
    open: async (p) => {
      await newProject(p);
      await p.setViewportSize({ width: 400, height: 800 });
      await p.getByRole("button", { name: "Show chapters" }).click();
      await shown(p.getByRole("navigation", { name: "Chapters" }));
    },
  },
  {
    name: "audiobook export, rendering",
    open: async (p) => {
      await p.addInitScript(() => {
        window.__audioHold = true;
      });
      await startAudiobook(p);
      await shown(dialogOf(p, "Export book").getByRole("progressbar"));
      // The spinner turns forever, and the specs wait for every animation to finish before they measure; it is not a
      // fault (motion-reduce turns it off), so it is stopped here.
      await p.evaluate(() => {
        for (const a of document.getAnimations())
          if (a.effect?.getComputedTiming().iterations === Infinity) a.cancel();
      });
    },
  },
  {
    name: "audiobook export, done",
    open: async (p) => {
      await startAudiobook(p);
      await shown(dialogOf(p, "Export book").getByRole("button", { name: "Done" }));
    },
  },
  {
    name: "audiobook export, error",
    open: async (p) => {
      await covBackend(p);
      await startAudiobook(p, async () => {
        await failOn(p, "audio_render_chapter", { kind: "synth", message: "engine broke" });
      });
      await shown(dialogOf(p, "Export book").getByRole("alert"));
    },
  },
  {
    name: "Import report dialog",
    open: async (p) => {
      await fakeImportSources(p, "md");
      await home(p);
      await p.getByRole("button", { name: "Import…" }).click();
      const dialog = dialogOf(p, "Import a manuscript");
      await dialog.getByRole("button", { name: "Choose file…" }).click();
      await expect(dialog.getByLabel("File")).not.toHaveValue("");
      await dialog.getByRole("button", { name: "Choose…" }).click();
      await expect(dialog.getByLabel("New book folder")).toHaveValue("/newbook");
      await dialog.getByRole("button", { name: "Next" }).click();
      await dialog.getByRole("button", { name: "Import", exact: true }).click();
      await shown(dialogOf(p, "Import report"));
    },
  },
  {
    name: "Removed references dialog",
    open: async (p) => {
      await newProject(p);
      await p.evaluate(
        (contents) => {
          window.__pickedRefs = ["/refs/one.png"];
          window.__refFiles = { "/refs/one.png": contents };
        },
        refBytes(atob(PIXEL)),
      );
      const panel = p.getByRole("region", { name: "References" });
      await p.getByRole("button", { name: "References", exact: true }).first().click();
      await p.getByRole("button", { name: "Add files" }).click();
      await panel.getByRole("button", { name: "Actions for one" }).click();
      await p.getByRole("menuitem", { name: "Remove from book" }).click();
      await panel.getByRole("button", { name: "Removed references (1)" }).click();
      await shown(dialogOf(p, "Removed references"));
    },
  },
  {
    name: "Paste HTML dialog",
    open: async (p) => {
      await lastParagraph(p);
      await p.keyboard.type("Q");
      await p.evaluate(() => {
        const dt = new DataTransfer();
        dt.setData("text/plain", "<p>The gate was <b>old</b></p>");
        document
          .querySelector(".ProseMirror")!
          .dispatchEvent(
            new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }),
          );
      });
      await shown(dialogOf(p, "Paste as styled text?"));
    },
  },
  {
    name: "error screen",
    open: async (p) => {
      await newProject(p);
      // A render crash: the open book's manifest becomes something the shell cannot read.
      await p.evaluate(async () => {
        const { useProject } = await import("/src/state/project/index.ts" as string);
        useProject.setState({ manifest: { chapters: 1, pages: 1 } });
      });
      await shown(p.getByRole("heading", { name: "Something went wrong", level: 1 }));
    },
  },
  {
    name: "welcome screen",
    open: async (p) => {
      await newProject(p);
      await menu(p, "help.welcome");
      await shown(p.getByRole("heading", { name: "Welcome to CadabraCraft", level: 1 }));
    },
  },
  {
    name: "skip link focused",
    open: async (p) => {
      await newProject(p);
      await p.keyboard.press("Tab");
      await shown(p.getByRole("link", { name: "Skip to main content" }));
    },
  },
];

/** Every screen the accessibility specs audit. */
export const screens: Screen[] = [...baseScreens, ...moreScreens];
