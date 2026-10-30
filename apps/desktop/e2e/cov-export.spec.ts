import { expect, test, type Page } from "./support/coverage";
import { fakeTauri } from "./support/fakeTauri";
import {
  answerWith,
  calls,
  covBackend,
  failOn,
  hold,
  release,
  reopen,
  stopFailing,
} from "./support/cov";
import { newProject, noVoices, focusEnd } from "./support/helpers";

// Rare states of the export dialog, its panels, the print preview and the templates page (src/app/export).

test.beforeEach(async ({ page }) => {
  await fakeTauri(page);
  await covBackend(page);
});

const waitForCall = (page: Page, cmd: string, n: number) =>
  expect.poll(() => calls(page, cmd)).toBe(n);

const PIXEL =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

async function openExport(page: Page, format?: string) {
  await page.getByRole("button", { name: "Export", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Export book" });
  if (format) await dialog.getByRole("radio", { name: format }).click();
  return dialog;
}

const chapterFile = (page: Page) =>
  page.evaluate(
    () => JSON.parse(window.__disk["cadabra.json"] as string).chapters[0].files.en as string,
  );

test("audiobook without voices: choosing packs, a failed download, retry, and Cancel", async ({
  page,
}) => {
  await page.addInitScript(noVoices);
  await newProject(page);
  const dialog = await openExport(page, "Audiobook");
  const piper = dialog.getByLabel(/Piper voices/);
  const kokoro = dialog.getByLabel(/Kokoro/);
  const download = dialog.getByRole("button", { name: /Download selected/ });
  await kokoro.check();
  await expect(download).toHaveText("Download selected (508 MB)");
  await piper.uncheck();
  await expect(download).toHaveText("Download selected (360 MB)");
  await kokoro.uncheck();
  await expect(download).toBeDisabled();
  await piper.check();

  await failOn(page, "audio_download_pack", { kind: "network", message: "network down" });
  await download.click();
  await expect(dialog.getByRole("alert")).toContainText("Network down");
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  await expect(dialog).toHaveCount(0);

  const retryDialog = await openExport(page, "Audiobook");
  const retryDownload = retryDialog.getByRole("button", { name: /Download selected/ });
  await retryDownload.click();
  await expect(retryDialog.getByRole("alert")).toBeVisible();
  await stopFailing(page, "audio_download_pack");
  await retryDialog.getByRole("button", { name: "Try again" }).click();
  await expect(retryDialog.getByLabel("Voice")).toBeVisible();
  await retryDialog.getByRole("button", { name: "Cancel" }).click();
  await expect(retryDialog).toHaveCount(0);

  // Without voices, Cancel on the offer closes the dialog.
  await page.evaluate(noVoices);
  await openExport(page);
  await dialog.getByRole("radio", { name: "EPUB 3" }).click();
  await dialog.getByRole("radio", { name: "Audiobook" }).click();
  await expect(dialog.getByText("Voices are not installed")).toBeVisible();
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toHaveCount(0);
});

const someVoices = () => {
  window.__audioVoices = [
    { id: "piper-amy", engine: "piper", installed: true, languages: ["en"] },
    { id: "kokoro-heart", engine: "kokoro", installed: false, languages: ["en"] },
  ];
  window.__audioPacks = [
    { id: "piper", voices: ["piper-amy"], bytes: 147993194, installed: true },
    { id: "kokoro", voices: ["kokoro-heart"], bytes: 359719088, installed: false },
  ];
};

test("audiobook with some voices: download more, Cancel, a failed download, then the voices are there", async ({
  page,
}) => {
  await page.addInitScript(someVoices);
  await newProject(page);
  const dialog = await openExport(page, "Audiobook");
  await expect(dialog.getByLabel("Voice")).toHaveValue("piper-amy");
  const more = dialog.getByRole("button", { name: "Download more voices (360 MB)" });
  await more.click();
  await expect(dialog.getByText("Download more voices", { exact: true })).toBeVisible();
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(more).toBeVisible();

  await more.click();
  await failOn(page, "audio_download_pack", { kind: "network", message: "network down" });
  await dialog.getByRole("button", { name: /Download selected/ }).click();
  await expect(dialog.getByRole("alert")).toContainText("Network down");
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  await expect(more).toBeVisible();
  await stopFailing(page, "audio_download_pack");

  await more.click();
  await dialog.getByRole("button", { name: /Download selected/ }).click();
  await expect(dialog.getByLabel("Voice")).toBeVisible();
  await expect(
    dialog.getByRole("option", { name: "Kokoro · Heart (best quality)" }),
  ).toBeAttached();
  await expect(dialog.getByLabel("Voice")).toHaveValue("piper-amy");
});

test("audiobook: a download that is still running when the dialog is closed shows up again, and stopping it says so", async ({
  page,
}) => {
  await page.addInitScript(someVoices);
  await page.addInitScript(() => {
    window.__downloadHold = true;
  });
  await newProject(page);
  const dialog = await openExport(page, "Audiobook");
  await dialog.getByRole("button", { name: "Download more voices (360 MB)" }).click();
  await dialog.getByRole("button", { name: "Download selected (360 MB)" }).click();
  await expect(dialog.getByRole("progressbar", { name: "Download progress" })).toBeVisible();
  // The voices arrive from elsewhere while it runs.
  await page.evaluate(() => {
    window.__audioVoices = window.__audioVoices!.map((v) => ({ ...v, installed: true }));
    window.__audioPacks = window.__audioPacks!.map((p) => ({ ...p, installed: true }));
  });
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  const reopenedDialog = await openExport(page, "Audiobook");
  await expect(
    reopenedDialog.getByRole("progressbar", { name: "Download progress" }),
  ).toBeVisible();
  await hold(page, "audio_cancel");
  await reopenedDialog.getByRole("button", { name: "Cancel download" }).click();
  await expect(reopenedDialog.getByRole("status").filter({ hasText: "Stopping…" })).toBeVisible();
  await expect(reopenedDialog.getByRole("button", { name: "Cancel download" })).toBeDisabled();
  await release(page, "audio_cancel");
  await expect(reopenedDialog.getByText("Stopped. What was downloaded is kept")).toBeVisible();
  await reopenedDialog.getByRole("button", { name: "Close", exact: true }).click();
  await expect(reopenedDialog.getByLabel("Voice")).toBeVisible();
});

test("audiobook options: chapters, formats, the sample and a failed export", async ({ page }) => {
  await page.addInitScript(() => {
    // The sample never ends by itself, so "Stop sample" can be pressed.
    HTMLMediaElement.prototype.play = () => new Promise(() => {});
  });
  await newProject(page);
  await page.getByRole("button", { name: "Add chapter" }).click();
  await expect(page.locator(".ProseMirror h1")).toHaveText("Chapter 2");
  const dialog = await openExport(page, "Audiobook");

  // The last format stays ticked; unlike a successful uncheck, this click is intentionally refused.
  await dialog.getByLabel("Opus").click();
  await expect(dialog.getByLabel("Opus")).toBeChecked();

  await dialog.getByLabel("Chapters", { exact: true }).selectOption("some");
  const group = dialog.getByRole("group", { name: "Chapters to read" });
  const boxes = group.getByRole("checkbox");
  await expect(boxes).toHaveCount(2);
  await expect(dialog.getByText("Reads 2 chapters, one audio file each.")).toBeVisible();
  await boxes.nth(1).uncheck();
  await expect(dialog.getByText("Reads 1 chapter, as one audio file.")).toBeVisible();
  await boxes.nth(1).check();
  await boxes.nth(0).uncheck();
  await boxes.nth(1).uncheck();
  await expect(dialog.getByRole("button", { name: "Export audiobook" })).toBeDisabled();
  await expect(dialog.getByRole("button", { name: "Hear a sample" })).toBeDisabled();
  await boxes.nth(0).check();

  // A sample of the chosen chapters: stop while it is made, then while it plays.
  await hold(page, "audio_sample");
  await dialog.getByRole("button", { name: "Hear a sample" }).click();
  await expect(dialog.getByRole("button", { name: "Making sample… (stop)" })).toBeVisible();
  await dialog.getByRole("button", { name: "Making sample… (stop)" }).click();
  await failOn(page, "audio_sample", { kind: "cancelled", message: "cancelled" });
  await release(page, "audio_sample");
  await expect(dialog.getByRole("button", { name: "Hear a sample" })).toBeVisible();
  await stopFailing(page, "audio_sample");
  await dialog.getByRole("button", { name: "Hear a sample" }).click();
  await dialog.getByRole("button", { name: "Stop sample" }).click();
  await expect(dialog.getByRole("button", { name: "Hear a sample" })).toBeVisible();
  const sample = await page.evaluate(() => window.__sampleCalls.at(-1)!);
  expect(Object.keys(sample)).toEqual(["jobId", "chunks", "voice", "speed"]);

  // Back to every chapter; a chapter that fails stops the export and is marked.
  await dialog.getByLabel("Chapters", { exact: true }).selectOption("all");
  await failOn(page, "audio_render_chapter", { kind: "synth", message: "engine broke" });
  await dialog.getByRole("button", { name: "Export audiobook" }).click();
  await expect(dialog.getByRole("alert")).toContainText("engine broke");
  await expect(dialog.getByText("Stopped", { exact: true })).toBeVisible();
  await expect(dialog.getByText("Waiting", { exact: true })).toBeVisible();
  await stopFailing(page, "audio_render_chapter");
  await dialog.getByRole("button", { name: "Back to options" }).click();

  // A chapter file that is gone makes the export (and a sample) fail before anything starts.
  const file = await chapterFile(page);
  await page.evaluate((f) => {
    delete window.__disk[f];
  }, file);
  await dialog.getByRole("button", { name: "Export audiobook" }).click();
  await expect(dialog.getByRole("alert")).toContainText("Missing chapter file");
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toHaveCount(0);
});

test("audiobook: answers that arrive after the panel was left are dropped", async ({ page }) => {
  await newProject(page);
  const dialog = await openExport(page);
  await hold(page, "audio_voices");
  await dialog.getByRole("radio", { name: "Audiobook" }).click();
  await waitForCall(page, "audio_voices", 1);
  await dialog.getByRole("radio", { name: "Markdown" }).click();
  await release(page, "audio_voices");

  await failOn(page, "audio_voices", "no voices");
  await hold(page, "audio_voices");
  await dialog.getByRole("radio", { name: "Audiobook" }).click();
  await waitForCall(page, "audio_voices", 2);
  await dialog.getByRole("radio", { name: "Markdown" }).click();
  await release(page, "audio_voices");

  await dialog.getByRole("radio", { name: "Audiobook" }).click();
  await expect(dialog.getByRole("alert")).toContainText("no voices");
});

test("the EPUB and PDF panels drop book reads that finish after they were left, and survive unreadable chapters", async ({
  page,
}) => {
  await newProject(page);
  const dialog = await openExport(page);
  const readsBeforePdf = await calls(page, "read_project_file");
  await hold(page, "read_project_file");
  await dialog.getByRole("radio", { name: "Print PDF" }).click();
  await waitForCall(page, "read_project_file", readsBeforePdf + 1);
  await dialog.getByRole("radio", { name: "Markdown" }).click();
  await release(page, "read_project_file");
  await dialog.getByRole("radio", { name: "EPUB 3" }).click();
  await expect(dialog.getByRole("list", { name: "Checks" })).toBeVisible();

  const file = await chapterFile(page);
  await page.evaluate((f) => {
    delete window.__disk[f];
  }, file);
  await dialog.getByRole("radio", { name: "Print PDF" }).click(); // unreadable: no page estimate, no checks
  await expect(dialog.getByRole("list", { name: "Print checks" })).toHaveCount(0);
  await dialog.getByRole("radio", { name: "EPUB 3" }).click();
  await expect(dialog.getByRole("list", { name: "Checks" })).toBeVisible();

  const readsBeforeLatePdf = await calls(page, "read_project_file");
  await hold(page, "read_project_file");
  await dialog.getByRole("radio", { name: "Markdown" }).click();
  await dialog.getByRole("radio", { name: "EPUB 3" }).click();
  await waitForCall(page, "read_project_file", readsBeforeLatePdf + 1);
  await dialog.getByRole("radio", { name: "Markdown" }).click();
  await dialog.getByRole("radio", { name: "Print PDF" }).click();
  await dialog.getByRole("radio", { name: "Markdown" }).click();
  await release(page, "read_project_file");
  await expect(dialog.getByLabel("Keep underline and small caps")).toBeVisible();
});

test("export dialog: Cancel, and a running export cannot be closed", async ({ page }) => {
  await newProject(page);
  const dialog = await openExport(page);
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toHaveCount(0);

  await openExport(page);
  await hold(page, "write_project_bytes");
  await dialog.getByRole("button", { name: "Export", exact: true }).click();
  await expect(dialog.getByRole("button", { name: "Exporting…" })).toBeDisabled();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeVisible();
  await release(page, "write_project_bytes");
  await expect(dialog).toHaveCount(0);
});

test("print PDF: the cover can be left out and an unknown template falls back", async ({
  page,
}) => {
  await newProject(page);
  await reopen(
    page,
    (png) => {
      const disk = window.__disk;
      const m = JSON.parse(disk["cadabra.json"] as string);
      m.editions[0].cover = "assets/pic.png";
      m.template = "no-such-template";
      disk["cadabra.json"] = JSON.stringify(m);
      disk["assets/pic.png"] = Array.from(atob(png), (c) => c.charCodeAt(0));
    },
    PIXEL,
  );
  const dialog = await openExport(page, "Print PDF");
  await expect(dialog.getByLabel("Template")).toHaveValue("novel");
  await expect(dialog.getByLabel("Include the cover")).toBeChecked();
  await dialog.getByLabel("Include the cover").uncheck();
  await dialog.getByLabel("Include the cover").check();

  await page.evaluate(() => {
    window.__typstError = { kind: "not_found", message: "The typst program was not found." };
  });
  await dialog.getByRole("button", { name: "Export", exact: true }).click();
  await expect(dialog.getByRole("alert")).toBeVisible();
  await expect(dialog.getByLabel("Typst location (optional)")).toHaveCount(0);
  await page.evaluate(() => {
    delete window.__typstError;
  });
  await dialog.getByRole("button", { name: "Export", exact: true }).click();
  await expect(dialog).toHaveCount(0);
});

test("editions checklist: untoggling an edition and a pending page whose title is only in the source", async ({
  page,
}) => {
  await newProject(page);
  await reopen(
    page,
    () => {
      const disk = window.__disk;
      const m = JSON.parse(disk["cadabra.json"] as string);
      m.editions.push({ ...m.editions[0], language: "fr", identifier: "fr-1" });
      disk["cadabra.json"] = JSON.stringify(m);
    },
    null,
  );
  const dialog = await openExport(page, "EPUB 3");
  await dialog.getByLabel("Français").check();
  await expect(dialog.getByText("Not translated yet in Français: Chapter One")).toBeVisible();
  await dialog.getByLabel("Skip untranslated chapters").check();
  await dialog.getByLabel("Skip untranslated chapters").uncheck();
  await dialog.getByLabel("Français").uncheck();
  await dialog.getByLabel("English").uncheck();
  await expect(dialog.getByText("Pick an edition to export.")).toBeVisible();
});

async function typeParagraphs(page: Page) {
  await focusEnd(page);
  await page.keyboard.type("First paragraph of the chapter.");
  await page.keyboard.press("Enter");
  await page.keyboard.type("Second paragraph of the chapter.");
}

const typstRuns = (page: Page) => page.evaluate(() => (window.__typstCalls ?? []).length);

test("print preview: the typeset pages, margins, crop marks, bleed, trim size and the way into the export dialog", async ({
  page,
}) => {
  await newProject(page);
  await typeParagraphs(page);
  await reopen(
    page,
    (png) => {
      const disk = window.__disk;
      const m = JSON.parse(disk["cadabra.json"] as string);
      m.editions[0].cover = "assets/pic.png";
      m.template = "no-such-template";
      disk["cadabra.json"] = JSON.stringify(m);
      disk["assets/pic.png"] = Array.from(atob(png), (c) => c.charCodeAt(0));
    },
    PIXEL,
  );
  const dialog = await openExport(page, "Print PDF");
  await dialog.getByRole("button", { name: "Print preview" }).click();
  await expect(page.getByRole("heading", { name: "Print preview" })).toBeVisible();
  // Typst's pages replace the estimate: the cover is page 1 on its own, then facing pages.
  await expect(page.getByRole("img", { name: "Page 1", exact: true })).toBeVisible();
  await expect(page.getByTestId("spread-label")).toHaveText("Page 1 of 6");
  await expect(page.getByTestId("page-count")).toHaveText("6 pages in the PDF");
  expect(await typstRuns(page)).toBe(1);
  const source = await page.evaluate(() => window.__typstCalls[0]!.source);
  expect(source).toContain("#page(margin: 0pt, header: none, footer: none)"); // the cover
  await page.getByRole("button", { name: "Next pages" }).click();
  await expect(page.getByTestId("spread-label")).toHaveText("Pages 2 and 3 of 6");
  await expect(page.getByRole("img", { name: "Page 3", exact: true })).toBeVisible();

  // Margins are outlined on book pages, not on the cover or the blank page behind it.
  const outlines = page.getByTestId("margin-outline");
  await expect(outlines).toHaveCount(1);
  await page.getByRole("switch", { name: "Show margins" }).click();
  await expect(outlines).toHaveCount(0);
  await page.getByRole("switch", { name: "Show margins" }).click();
  await expect(outlines).toHaveCount(1);

  // Crop marks turn the bleed on and typeset again; going back to what was shown is served from the cache.
  await page.getByRole("switch", { name: "Crop marks" }).click();
  await expect(page.getByLabel("Bleed")).toHaveValue("kdp");
  await expect.poll(() => typstRuns(page)).toBe(2);
  expect(await page.evaluate(() => window.__typstCalls[1]!.source)).toContain("foreground:");
  await page.getByLabel("Trim size").selectOption("5x8");
  await expect.poll(() => typstRuns(page)).toBe(3);
  expect(await page.evaluate(() => window.__typstCalls[2]!.source)).toMatch(
    /#set page\(width: 5\.75in, height: 8\.75in/,
  );
  await page.getByLabel("Trim size").selectOption("5.5x8.5"); // seen with marks: from the cache
  await page.getByRole("switch", { name: "Crop marks" }).click(); // the bleed stays: a new run
  await expect.poll(() => typstRuns(page)).toBe(4);
  await page.getByLabel("Bleed").selectOption("none"); // the first one again: from the cache
  await expect(page.getByTestId("page-count")).toHaveText("6 pages in the PDF");
  await page.getByLabel("Bleed").selectOption("kdp");
  await expect(page.getByRole("img", { name: "Page 3", exact: true })).toBeVisible();
  await page.waitForTimeout(500);
  expect(await typstRuns(page)).toBe(4);

  await page.getByRole("button", { name: "Export EPUB" }).click();
  await expect(dialog.getByRole("radio", { name: "EPUB 3" })).toBeChecked();
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await page.getByRole("button", { name: "Export PDF" }).click();
  await expect(dialog.getByRole("radio", { name: "Print PDF" })).toBeChecked();
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await expect(page.locator(".ProseMirror")).toBeVisible();

  // Another look: sans serif, paragraphs with space between them.
  await page.getByRole("button", { name: "Change template" }).click();
  await page.getByRole("radio", { name: /^Modern/ }).click();
  await expect(page.getByText("Any page")).toBeVisible();
  await page.getByRole("button", { name: "Use template" }).click();
  await page.getByRole("button", { name: "Export", exact: true }).click();
  await dialog.getByRole("button", { name: "Print preview" }).click();
  // The fake machine has no Inter, so Typst refuses: the estimate is drawn and the reason is given.
  await expect(page.getByRole("alert")).toContainText("Showing an approximate layout");
  await expect(page.getByRole("alert")).toContainText("are on this computer");
  await expect(page.getByText("First paragraph of the chapter.")).toBeVisible();
});

test("print preview: while Typst works the page says so, and when it cannot run an estimate is drawn with the reason", async ({
  page,
}) => {
  await newProject(page);
  await typeParagraphs(page);
  await page.evaluate(() => {
    window.__compileError = { kind: "compile", message: "main.typ:4:2: error: boom" };
  });
  const dialog = await openExport(page, "Print PDF");
  await dialog.getByRole("button", { name: "Print preview" }).click();
  await expect(page.getByText("Typesetting the preview with Typst…")).toBeVisible();
  await expect(page.getByRole("alert")).toContainText("Showing an approximate layout");
  await expect(page.getByRole("alert")).toContainText("boom");
  await expect(page.getByText("First paragraph of the chapter.")).toBeVisible();
  await expect(page.getByTestId("page-count")).toHaveText(/About \d+ pages?/);
  await expect(page.getByRole("button", { name: "Next pages" })).toHaveCount(0);
  // Bleed and crop marks are still drawn on the estimate.
  await page.getByRole("switch", { name: "Crop marks" }).click();
  await page.getByLabel("Bleed").selectOption("none");
  await page.getByRole("switch", { name: "Show margins" }).click();
  await page.getByRole("switch", { name: "Show margins" }).click();
  await page.getByLabel("Trim size").selectOption("5x8");

  // Once Typst works again, a change of option shows the real pages.
  await page.evaluate(() => {
    delete window.__compileError;
  });
  await page.getByLabel("Trim size").selectOption("6x9");
  await expect(page.getByRole("img", { name: "Page 1", exact: true })).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
});

test("print preview: an odd page count leaves the last right-hand page empty, and the preview survives a shorter PDF", async ({
  page,
}) => {
  await newProject(page);
  await page.evaluate(() => {
    window.__typstPages = 4;
  });
  const dialog = await openExport(page, "Print PDF");
  await dialog.getByRole("button", { name: "Print preview" }).click();
  await page.getByRole("button", { name: "Next pages" }).click();
  await page.getByRole("button", { name: "Next pages" }).click();
  await expect(page.getByTestId("spread-label")).toHaveText("Page 4 of 4");
  await expect(page.getByRole("button", { name: "Next pages" })).toBeDisabled();
  await page.evaluate(() => {
    window.__typstPages = 2;
  });
  await page.getByLabel("Trim size").selectOption("7x10");
  await expect(page.getByTestId("page-count")).toHaveText("2 pages in the PDF");
  await expect(page.getByTestId("spread-label")).toHaveText("Page 2 of 2");
});

test("print preview: a cover that is replaced before it is read, a missing cover and unreadable chapters", async ({
  page,
}) => {
  await newProject(page);
  await reopen(
    page,
    (png) => {
      const disk = window.__disk;
      const m = JSON.parse(disk["cadabra.json"] as string);
      m.editions[0].cover = "assets/late.png";
      disk["cadabra.json"] = JSON.stringify(m);
      disk["assets/late.png"] = Array.from(atob(png), (c) => c.charCodeAt(0));
    },
    PIXEL,
  );
  const toPreview = async () => {
    const dialog = await openExport(page, "Print PDF");
    await dialog.getByRole("button", { name: "Print preview" }).click();
    await expect(page.getByRole("heading", { name: "Print preview" })).toBeVisible();
  };
  const assetsBefore = await calls(page, "read_asset");
  await hold(page, "read_asset");
  await toPreview();
  await waitForCall(page, "read_asset", assetsBefore + 1);
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await release(page, "read_asset");

  // The cover file is not there. Drop its cached object URL so the next preview must read from disk again.
  await page.evaluate(() => {
    delete window.__disk["assets/late.png"];
    sessionStorage.setItem("disk", JSON.stringify(window.__disk));
  });
  await page.reload();
  await page.getByRole("button", { name: "Open folder" }).click();
  await expect(page.locator(".ProseMirror")).toBeVisible();
  await toPreview();
  await expect(page.getByRole("img", { name: "Cover" })).toHaveCount(0);
  await page.getByRole("button", { name: "Back", exact: true }).click();

  const file = await chapterFile(page);
  await page.evaluate((f) => {
    delete window.__disk[f];
  }, file);
  await toPreview();
  await expect(page.getByRole("alert").first()).toContainText("Missing chapter file");
});

test("templates page: the book's own look, a failed save and a template that is not Nonfiction", async ({
  page,
}) => {
  await newProject(page);
  await reopen(
    page,
    () => {
      const disk = window.__disk;
      const m = JSON.parse(disk["cadabra.json"] as string);
      m.template = "nonfiction";
      disk["cadabra.json"] = JSON.stringify(m);
    },
    null,
  );
  await page.getByRole("button", { name: "Change template" }).click();
  await expect(page.getByRole("radio", { name: /^Nonfiction · In use/ })).toBeVisible();
  await page.getByRole("radio", { name: /^Poetry/ }).click();
  await failOn(page, "write_project_file", { kind: "io", message: "No space left on device" });
  await page.getByRole("button", { name: "Use template" }).click();
  await expect(page.getByRole("alert")).toContainText("No space left on device");
  await stopFailing(page, "write_project_file");
  await page.getByRole("button", { name: "Back", exact: true }).click();

  await reopen(
    page,
    () => {
      const disk = window.__disk;
      const m = JSON.parse(disk["cadabra.json"] as string);
      m.template = "no-such-template";
      disk["cadabra.json"] = JSON.stringify(m);
    },
    null,
  );
  await page.getByRole("button", { name: "Change template" }).click();
  await expect(page.getByRole("radio", { name: /^Classic Novel · In use/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /^Nonfiction/ })).toHaveCount(0);
});

test("templates page: the arrow keys move the choice and wrap around", async ({ page }) => {
  await newProject(page);
  await page.getByRole("button", { name: "Change template" }).click();
  const group = page.getByRole("radiogroup", { name: "Templates" });
  const radios = group.getByRole("radio");
  const checked = () =>
    radios.evaluateAll((els) => els.findIndex((e) => e.getAttribute("aria-checked") === "true"));
  const count = await radios.count();
  await radios.nth(0).click();
  expect(await checked()).toBe(0);
  await page.keyboard.press("ArrowLeft"); // wraps to the last
  expect(await checked()).toBe(count - 1);
  await page.keyboard.press("ArrowRight"); // and back to the first
  expect(await checked()).toBe(0);
  await page.keyboard.press("ArrowDown");
  expect(await checked()).toBe(1);
  await page.keyboard.press("ArrowUp");
  expect(await checked()).toBe(0);
  await page.keyboard.press("x"); // not an arrow: nothing moves
  expect(await checked()).toBe(0);
  await expect(radios.nth(0)).toBeFocused();
});

// Keeps the helper imports honest for specs that only need some of them.
void answerWith;
