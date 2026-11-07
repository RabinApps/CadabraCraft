import { expect, type Page } from "@playwright/test";
import { fakeImportSources } from "./fakeImport";
import { answer, covBackend, failOn } from "./cov";
import { addReference, newProject } from "./helpers";
import { filterBook, openBoard, openTimeline, pick, search } from "./sceneFilterBook";
import {
  toolbar,
  dialogOf,
  shown,
  menu,
  home,
  exportPanel,
  lastParagraph,
  sceneBoard,
  timeline,
  contentsPage,
  type Screen,
} from "./a11yScreenHelpers";

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
  await addReference(page, "Add files");
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
    name: "Split chapter dialog",
    open: async (p) => {
      await newProject(p);
      await p.evaluate(() => {
        window.__disk["manuscript/001-chapter-one.json"] = JSON.stringify({
          type: "doc",
          content: [
            {
              type: "heading",
              attrs: { level: 1 },
              content: [{ type: "text", text: "Chapter One" }],
            },
            { type: "paragraph", content: [{ type: "text", text: "Intro." }] },
            { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Next" }] },
            { type: "paragraph", content: [{ type: "text", text: "More." }] },
          ],
        });
      });
      await p.getByRole("button", { name: "Actions for Chapter One" }).click();
      await p.getByRole("menuitem", { name: "Split at heading…" }).click();
      await shown(dialogOf(p, "Split “Chapter One”").getByRole("radio", { name: "Next" }));
    },
  },
  {
    name: "Read mode, find bar with results",
    open: async (p) => {
      await newProject(p);
      await p.getByRole("radio", { name: "Read" }).click();
      await p.keyboard.press("ControlOrMeta+f");
      await p.keyboard.type("chapter");
      await shown(p.getByRole("search", { name: "Find in the book" }).getByText(/1 of/));
    },
  },
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
    name: "Story structure dialog",
    open: async (p) => {
      await sceneBoard(p);
      await p.getByRole("button", { name: "Story structure" }).click();
      await shown(dialogOf(p, "Add a story structure"));
    },
  },
  {
    name: "Timeline",
    open: async (p) => {
      await timeline(p);
    },
  },
  {
    name: "Timeline, story date order",
    open: async (p) => {
      await timeline(p);
      await p.getByRole("radio", { name: "Story date" }).click();
      await shown(p.getByText("Scenes are ordered by story date."));
    },
  },
  {
    name: "Scene board, filtered and coloured by label",
    open: async (p) => {
      await filterBook(p);
      await openBoard(p);
      await pick(p, "POV", ["Mara"]);
      await p.getByRole("radio", { name: "Label" }).click();
      await shown(p.getByText("Moving scenes is off while a filter is on"));
    },
  },
  {
    name: "Scene board, filter menu open",
    open: async (p) => {
      await filterBook(p);
      await openBoard(p);
      await p.getByRole("button", { name: /^POV/ }).click();
      await shown(p.getByRole("menuitemcheckbox", { name: "Mara 2" }));
    },
  },
  {
    name: "Scene board, no scene matches",
    open: async (p) => {
      await filterBook(p);
      await openBoard(p);
      await search(p).fill("zzzzq");
      await shown(p.getByText("No scenes match these filters."));
    },
  },
  {
    name: "Timeline, filtered and coloured by status",
    open: async (p) => {
      await filterBook(p);
      await openTimeline(p);
      await pick(p, "Label", ["Past"]);
      await p.getByRole("radio", { name: "Status" }).click();
      await shown(p.getByRole("button", { name: /^Label: Past/ }));
    },
  },
  {
    name: "Timeline, no scene matches",
    open: async (p) => {
      await filterBook(p);
      await openTimeline(p);
      await search(p).fill("zzzzq");
      await shown(p.getByText("No scenes match these filters."));
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
  { name: "export dialog, Outline panel", open: exportPanel("Outline") },
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
      await addReference(p, "Add files");
      await panel.getByRole("button", { name: "Actions for one" }).click();
      await p.getByRole("menuitem", { name: "Remove from book" }).click();
      await panel.getByRole("button", { name: "Removed references (1)" }).click();
      await shown(dialogOf(p, "Removed references"));
    },
  },
  {
    name: "References add menu",
    open: async (p) => {
      await newProject(p);
      await p.getByRole("button", { name: "References", exact: true }).first().click();
      await p
        .getByRole("region", { name: "References" })
        .getByRole("button", { name: "Add", exact: true })
        .click();
      await shown(p.getByRole("menuitem", { name: "Add link" }));
    },
  },
  {
    name: "References add link dialog",
    open: async (p) => {
      await newProject(p);
      await p.getByRole("button", { name: "References", exact: true }).first().click();
      await addReference(p.getByRole("region", { name: "References" }), "Add link");
      await shown(dialogOf(p, "Add link"));
    },
  },
  {
    name: "References add link dialog with an error",
    open: async (p) => {
      await newProject(p);
      await p.getByRole("button", { name: "References", exact: true }).first().click();
      await addReference(p.getByRole("region", { name: "References" }), "Add link");
      const dialog = dialogOf(p, "Add link");
      await dialog.getByLabel("Address").fill("javascript:alert(1)");
      await dialog.getByRole("button", { name: "Add link" }).click();
      await shown(dialog.getByText("Enter an address that starts with http:// or https://."));
    },
  },
  {
    name: "References add note dialog",
    open: async (p) => {
      await newProject(p);
      await p.getByRole("button", { name: "References", exact: true }).first().click();
      await addReference(p.getByRole("region", { name: "References" }), "Add note");
      await shown(dialogOf(p, "Add note"));
    },
  },
  {
    name: "References panel taking a drop",
    open: async (p) => {
      await newProject(p);
      await p.getByRole("button", { name: "References", exact: true }).first().click();
      await p.evaluate(() =>
        window.__emit!("tauri://drag-enter", { paths: ["/a.pdf"], position: { x: 0, y: 0 } }),
      );
      await shown(
        p
          .getByRole("region", { name: "References" })
          .getByRole("button", { name: "Release to add files, links or text" }),
      );
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
