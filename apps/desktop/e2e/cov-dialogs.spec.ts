import { expect, test, type Page } from "./support/coverage";
import { fakeTauri } from "./support/fakeTauri";
import {
  answer,
  answerWith,
  calls,
  covBackend,
  failOn,
  hold,
  menu,
  release,
  reopen,
  stopFailing,
} from "./support/cov";
import { chapterAction, newProject, seedSnapshot } from "./support/helpers";

// Failure, timing and rare-state paths of the dialogs (src/app/dialogs). The cases that need a particular backend answer
// or a held call use the wrapper in support/cov.ts on top of the fake Tauri backend.

test.beforeEach(async ({ page }) => {
  await fakeTauri(page);
  await covBackend(page);
});

const waitForCall = (page: Page, cmd: string, n: number) =>
  expect.poll(() => calls(page, cmd)).toBe(n);

test("update dialog: Escape and Later wait for the next launch, a failed install keeps the dialog, an install blocks closing", async ({
  page,
}) => {
  await newProject(page);
  await answer(page, "updates_supported", true);
  await answer(page, "plugin:updater|check", {
    rid: 7,
    currentVersion: "0.1.0",
    version: "0.2.0",
  });
  await answer(page, "plugin:updater|download_and_install", null);
  await answer(page, "plugin:process|restart", null);
  const dialog = page.getByRole("dialog", { name: "Version 0.2.0 is available" });

  await menu(page, "help.updates");
  await expect(
    dialog.getByText("You have 0.1.0. Your books and settings stay as they are."),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);

  await menu(page, "help.updates");
  await dialog.getByRole("button", { name: "Later" }).click();
  await expect(dialog).toHaveCount(0);

  // The install runs: nothing can close the dialog until it ends, and a failure is shown without an update to install again.
  await menu(page, "help.updates");
  await hold(page, "plugin:updater|download_and_install");
  await dialog.getByRole("button", { name: "Install now" }).click();
  const failed = page.getByRole("dialog", { name: "Update available" }); // without the version while installing
  await expect(failed.getByRole("button", { name: "Installing…" })).toBeDisabled();
  await expect(failed.getByRole("button", { name: "Later" })).toBeDisabled();
  await page.keyboard.press("Escape");
  await expect(failed).toBeVisible();
  await failOn(page, "plugin:updater|download_and_install", "disk full");
  await release(page, "plugin:updater|download_and_install");
  await expect(failed.getByRole("alert")).toHaveText("Could not install the update: disk full");
  await expect(failed.getByRole("button", { name: "Install now" })).toBeDisabled();
  await page.keyboard.press("Escape");
  await expect(failed).toHaveCount(0);

  // After a failure the next check starts again, and this time the install goes through.
  await stopFailing(page, "plugin:updater|download_and_install");
  await menu(page, "help.updates");
  await dialog.getByRole("button", { name: "Install now" }).click();
  await expect(failed.getByRole("button", { name: "Installing…" })).toBeVisible();
  await expect.poll(() => calls(page, "plugin:process|restart")).toBe(1);
});

test("recover dialog: Escape keeps the saved text, a failed restore is shown, then the newer text is used", async ({
  page,
}) => {
  await newProject(page);
  const { file, path } = await seedSnapshot(page, "the newer text");
  await page.evaluate((x) => sessionStorage.setItem("stale", JSON.stringify([x])), {
    path: file,
    snapshot: path,
  });
  const dialog = page.getByRole("dialog", { name: "Recover newer text for “Chapter One”?" });

  await reopen(page, () => {}, null);
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);

  await reopen(page, () => {}, null);
  await failOn(page, "restore_page_snapshot", "restore broke");
  await dialog.getByRole("button", { name: "Use newer text" }).click();
  await expect(dialog.getByRole("alert")).toHaveText("restore broke");
  await dialog.getByRole("button", { name: "Keep saved text" }).click();
  await expect(dialog).toHaveCount(0);

  await stopFailing(page, "restore_page_snapshot");
  await reopen(page, () => {}, null);
  await dialog.getByRole("button", { name: "Use newer text" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator(".ProseMirror")).toContainText("the newer text");
});

test("sponsor dialog: a browser that cannot be opened is reported", async ({ page }) => {
  await page.addInitScript(() => {
    sessionStorage.setItem("sponsorTest", "1");
    localStorage.removeItem("cadabracraft.sponsor");
  });
  await newProject(page);
  await failOn(page, "plugin:opener|open_url", "no browser");
  await page.getByRole("button", { name: "Export", exact: true }).click();
  await page
    .getByRole("dialog", { name: "Export book" })
    .getByRole("button", { name: "Export", exact: true })
    .click();
  const sponsor = page.getByRole("dialog", { name: "Enjoying CadabraCraft?" });
  await sponsor.getByRole("button", { name: "Sponsor", exact: true }).click();
  await expect(sponsor).toHaveCount(0);
  await expect(page.getByRole("status")).toHaveText(
    "Could not open https://github.com/sponsors/RabinApps: no browser",
  );
});

test("add language: Escape, Cancel and a failed add keep the dialog, a busy add cannot be closed, and a full book says so", async ({
  page,
}) => {
  await newProject(page);
  const open = async () => {
    await page.getByRole("button", { name: /Edition: / }).click();
    await page.getByRole("menuitem", { name: "Add language" }).click();
  };
  const dialog = page.getByRole("dialog", { name: "Add language" });
  await open();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);

  await open();
  await dialog.getByLabel("Start empty").check();
  await failOn(page, "write_project_file", { kind: "io", message: "No space left on device" });
  await dialog.getByRole("button", { name: "Add language", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText("No space left on device");
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toHaveCount(0);
  await stopFailing(page, "write_project_file");

  await open();
  await hold(page, "write_project_file");
  await dialog.getByRole("button", { name: "Add language", exact: true }).click();
  await expect(dialog.getByRole("button", { name: "Cancel" })).toBeDisabled();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeVisible();
  await release(page, "write_project_file");
  await expect(dialog).toHaveCount(0);

  // Every language of the picker is already an edition.
  await reopen(
    page,
    (languages) => {
      const disk = window.__disk;
      const m = JSON.parse(disk["cadabra.json"] as string);
      const source = m.editions[0];
      for (const l of languages) {
        if (m.editions.some((e: { language: string }) => e.language === l)) continue;
        m.editions.push({ ...source, language: l, identifier: `${source.identifier}-${l}` });
        for (const section of ["frontMatter", "chapters", "backMatter"])
          for (const e of m[section]) {
            const file = `manuscript/${l}/${e.files.en.split("/").pop()}`;
            e.titles[l] = e.titles.en;
            e.files[l] = file;
            e.untranslated = [...(e.untranslated ?? []), l];
            if (disk instanceof Array) {
              disk[file] = disk[e.files.en];
            }
          }
      }
      disk["cadabra.json"] = JSON.stringify(m);
    },
    ["he", "ar", "it", "ja", "ru", "fr", "de", "es"],
  );
  await open();
  await expect(dialog.getByText("Every language is already in this book.")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
});

test("book details: validation, a cancelled or failed cover picker, an unreadable cover, a failed save and a busy save", async ({
  page,
}) => {
  await newProject(page);
  await page.getByRole("button", { name: "Book details" }).click();
  const dialog = page.getByRole("dialog", { name: "Book details" });
  const save = dialog.getByRole("button", { name: "Save details" });
  const alert = dialog.getByRole("alert");

  await dialog.getByLabel("Author").fill("");
  await save.click();
  await expect(alert).toHaveText("Give the book an author.");
  await dialog.getByLabel("Author").fill("Someone");
  await dialog.getByLabel("Identifier").fill("");
  await save.click();
  await expect(alert).toHaveText("The identifier cannot be empty.");
  await dialog.getByLabel("Identifier").fill("urn:test:1");
  await dialog.getByLabel("Title").fill("");
  await save.click();
  await expect(alert).toHaveText("Give the book a title.");
  await dialog.getByLabel("Title").fill("Renamed");

  // The picker is cancelled (nothing happens), then the copy of the image fails (the reason is shown).
  await answerWith(page, "plugin:dialog|open", "return null");
  await dialog.getByRole("button", { name: "Choose image…" }).click();
  await expect(alert).toHaveCount(0);
  await page.evaluate(() => {
    window.__importError = "image is too large";
  });
  await answerWith(page, "plugin:dialog|open", 'return "/pics/pic.png"');
  await dialog.getByRole("button", { name: "Choose image…" }).click();
  await expect(alert).toContainText("image is too large");
  await page.evaluate(() => {
    delete window.__importError;
  });

  // A cover that was replaced before it was read is dropped, whether the read fails or succeeds; one that cannot be read says so.
  await failOn(page, "read_asset", "missing");
  await hold(page, "read_asset");
  await dialog.getByRole("button", { name: "Choose image…" }).click();
  await dialog.getByRole("button", { name: "Remove cover" }).click();
  await release(page, "read_asset");
  await dialog.getByRole("button", { name: "Choose image…" }).click();
  await expect(dialog.getByText("The cover image could not be read.")).toBeVisible();
  await stopFailing(page, "read_asset");
  await dialog.getByRole("button", { name: "Remove cover" }).click();
  await hold(page, "read_asset");
  await dialog.getByRole("button", { name: "Choose image…" }).click();
  await dialog.getByRole("button", { name: "Remove cover" }).click();
  await release(page, "read_asset");
  await expect(dialog.getByRole("img", { name: "Cover preview" })).toHaveCount(0);

  // The save fails, then is held: a busy dialog does not close.
  await failOn(page, "write_project_file", { kind: "io", message: "No space left on device" });
  await save.click();
  await expect(alert).toContainText("No space left on device");
  await stopFailing(page, "write_project_file");
  await hold(page, "write_project_file");
  await save.click();
  await expect(dialog.getByRole("button", { name: "Cancel" })).toBeDisabled();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeVisible();
  await release(page, "write_project_file");
  await expect(dialog).toHaveCount(0);

  // A language outside the picker is kept as it is.
  await reopen(
    page,
    (lang) => {
      const disk = window.__disk;
      const m = JSON.parse(disk["cadabra.json"] as string);
      m.editions[0].language = lang;
      for (const section of ["frontMatter", "chapters", "backMatter"])
        for (const e of m[section]) {
          e.titles = { [lang]: e.titles.en };
          e.files = { [lang]: e.files.en };
        }
      disk["cadabra.json"] = JSON.stringify(m);
    },
    "pt",
  );
  await page.getByRole("button", { name: "Book details" }).click();
  await expect(dialog.getByLabel("Language")).toHaveValue("pt");
  await dialog.getByLabel("Language").selectOption("fr");
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toHaveCount(0);
});

const DOC = (text: string) =>
  JSON.stringify({
    type: "doc",
    content: [
      { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "Chapter One" }] },
      { type: "paragraph", content: [{ type: "text", text }] },
    ],
  });

test("history: unreadable, invalid, equal and different versions, and a failed restore", async ({
  page,
}) => {
  // Some browsers have no data for the locale; the stamps then use the default one.
  await page.addInitScript(() => {
    const w = window as unknown as { __badLocale?: boolean };
    window.Intl.DateTimeFormat = new Proxy(Intl.DateTimeFormat, {
      construct(target, args: [string?, object?]) {
        if (w.__badLocale && args[0]) throw new RangeError("Incorrect locale information provided");
        return Reflect.construct(target, args) as Intl.DateTimeFormat;
      },
    });
  });
  await newProject(page);
  await page.locator(".ProseMirror").click();
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.type("hello world");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("status")).toHaveText("Saved");
  await page.evaluate(
    ([doc, docBrave]) => {
      const disk = window.__disk;
      const file = JSON.parse(disk["cadabra.json"] as string).chapters[0].files.en as string;
      const at = (stamp: string) => `.cadabra/backups/${stamp}-${file.replaceAll("/", "__")}`;
      disk[at("20261027-1200")] = doc as string; // read fails below
      disk[at("20261027-1100")] = disk[file]!; // the same text as now
      disk[at("20261027-1000")] = docBrave as string;
      disk[at("20261027-0900")] = "not json";
      disk[at("20261027-0800")] = JSON.stringify({ type: "doc", content: [{ type: "bogus" }] });
      (window as unknown as { __badLocale?: boolean }).__badLocale = true;
    },
    [DOC("unreadable"), DOC("hello brave world")],
  );
  await failOn(page, "read_page_snapshot", "gone", 1);
  await chapterAction(page, "Chapter One", "History");
  const dialog = page.getByRole("dialog", { name: "History · Chapter One" });
  const versions = dialog.getByRole("list", { name: "Earlier versions" }).getByRole("listitem");
  await expect(versions).toHaveCount(5);
  await expect(dialog.getByText("Could not be read")).toHaveCount(3);
  await expect(dialog.getByRole("button", { name: "Restore this version" })).toBeDisabled();

  await versions.nth(1).click();
  await expect(versions.nth(1)).toContainText("same as now");
  await expect(
    dialog.getByText("This version has the same words as the current text."),
  ).toBeVisible();
  await versions.nth(2).click();
  await expect(dialog.getByLabel("Comparison").locator("ins, del").first()).toBeVisible();
  await expect(versions.nth(2)).not.toContainText("same as now");

  await failOn(page, "restore_page_snapshot", "restore broke");
  await dialog.getByRole("button", { name: "Restore this version" }).click();
  await expect(dialog.getByRole("alert")).toHaveText("restore broke");
  await stopFailing(page, "restore_page_snapshot");
  await dialog.getByRole("button", { name: "Restore this version" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator(".ProseMirror")).toContainText("hello brave world");
});

test("history: closing while the versions load drops the answer, and a failed listing is shown", async ({
  page,
}) => {
  await newProject(page);
  await page.evaluate((doc) => {
    const disk = window.__disk;
    const file = JSON.parse(disk["cadabra.json"] as string).chapters[0].files.en as string;
    disk[`.cadabra/backups/20261027-1000-${file.replaceAll("/", "__")}`] = doc;
  }, DOC("older"));
  const dialog = page.getByRole("dialog", { name: "History · Chapter One" });

  await hold(page, "list_page_snapshots");
  await chapterAction(page, "Chapter One", "History");
  await waitForCall(page, "list_page_snapshots", 1);
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await release(page, "list_page_snapshots");

  await hold(page, "read_page_snapshot");
  await chapterAction(page, "Chapter One", "History");
  await waitForCall(page, "read_page_snapshot", 1);
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await release(page, "read_page_snapshot");

  await failOn(page, "list_page_snapshots", "listing broke");
  await hold(page, "list_page_snapshots");
  await chapterAction(page, "Chapter One", "History");
  await waitForCall(page, "list_page_snapshots", 3);
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await release(page, "list_page_snapshots");

  await chapterAction(page, "Chapter One", "History");
  await expect(dialog.getByRole("alert")).toHaveText("listing broke");
  await dialog.getByRole("button", { name: "Close" }).click();
  await expect(dialog).toHaveCount(0);
});

// Import: the picker and the preview.
const A = `<html><body><h1>One</h1><p>first<br>second</p><h2>Two</h2><p>x <blink>y</blink></p><h1>Three</h1><p>z</p></body></html>`;
const B = `<html><body><h1>One</h1><p>first<br>second</p><h1>Two</h1><p>x</p></body></html>`;

async function serveImports(page: Page) {
  await answerWith(
    page,
    "read_import_source",
    `const f = ${JSON.stringify({ "/src/a.html": A, "/src/b.html": B })};
     if (!(a.path in f)) throw "cannot read " + a.path;
     return Array.from(new TextEncoder().encode(f[a.path]));`,
  );
  await answerWith(
    page,
    "plugin:dialog|open",
    'return a && a.options && a.options.filters ? window.__pick : "/newbook"',
  );
}
const picks = (page: Page, path: string | null) =>
  page.evaluate((p) => {
    (window as unknown as { __pick: string | null }).__pick = p;
  }, path);

test("import dialog: pickers that cancel, fail or answer late, a busy read and the heading levels", async ({
  page,
}) => {
  await page.goto("/");
  await serveImports(page);
  const dialog = page.getByRole("dialog", { name: "Import a manuscript" });
  const openDialog = () => page.getByRole("button", { name: "Import…" }).click();
  const chooseFile = dialog.getByRole("button", { name: "Choose file…" });
  await openDialog();

  await picks(page, null);
  await chooseFile.click();
  await waitForCall(page, "plugin:dialog|open", 1);
  await expect(dialog.getByLabel("File")).toHaveValue("");
  await failOn(page, "plugin:dialog|open", "picker broke");
  await chooseFile.click();
  await expect(dialog.getByRole("alert")).toContainText("picker broke");
  await stopFailing(page, "plugin:dialog|open");

  // Answers that arrive after the dialog was closed are dropped.
  await picks(page, "/src/a.html");
  await hold(page, "plugin:dialog|open");
  await chooseFile.click();
  await waitForCall(page, "plugin:dialog|open", 3);
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toHaveCount(0);
  await release(page, "plugin:dialog|open");
  await openDialog();
  await expect(dialog.getByLabel("File")).toHaveValue("");
  await hold(page, "plugin:dialog|open");
  await chooseFile.click();
  await waitForCall(page, "plugin:dialog|open", 4);
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toHaveCount(0);
  await failOn(page, "plugin:dialog|open", "late failure");
  await release(page, "plugin:dialog|open");
  await stopFailing(page, "plugin:dialog|open");
  await openDialog();
  await expect(dialog.getByRole("alert")).toHaveCount(0);

  await chooseFile.click();
  await expect(dialog.getByLabel("File")).toHaveValue("a.html");
  await dialog.getByLabel("Title").fill("Mine");
  await dialog.getByLabel("Author").fill("Me");
  await dialog.getByRole("button", { name: "Choose…" }).click();
  await expect(dialog.getByLabel("New book folder")).toHaveValue("/newbook");

  // A read in progress cannot be closed.
  await hold(page, "read_import_source");
  await dialog.getByRole("button", { name: "Next" }).click();
  await expect(dialog.getByRole("button", { name: "Reading…" })).toBeDisabled();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeVisible();
  await release(page, "read_import_source");

  const chapters = dialog.getByRole("list", { name: "Chapters" }).getByRole("listitem");
  await expect(chapters).toHaveCount(2);
  await dialog.getByRole("radio", { name: "Heading 2" }).click();
  await expect(dialog.getByRole("radio", { name: "Heading 2" })).toBeChecked();
  await dialog.getByRole("radio", { name: "Heading 3" }).click();
  await expect(dialog.getByRole("radio", { name: "Heading 3" })).toBeChecked();
  await dialog.getByRole("radio", { name: "Heading 1" }).click();
  await expect(chapters).toHaveCount(2);

  // A file the parser cannot cope with at another level is reported without leaving the step.
  await page.evaluate(() => {
    const w = window as unknown as { __noDecode?: boolean; TextDecoder: typeof TextDecoder };
    const Real = w.TextDecoder;
    w.TextDecoder = class extends Real {
      constructor(label?: string, options?: TextDecoderOptions) {
        if (w.__noDecode) throw new RangeError("Invalid string length");
        super(label, options);
      }
    };
    w.__noDecode = true;
  });
  await dialog.getByRole("radio", { name: "Heading 2" }).click();
  await expect(dialog.getByRole("alert")).toContainText("too large or too deeply nested");
  await page.evaluate(() => {
    (window as unknown as { __noDecode?: boolean }).__noDecode = false;
  });
  await dialog.getByRole("button", { name: "Back" }).click();
  await expect(dialog.getByLabel("Title")).toHaveValue("Mine");
  await dialog.getByRole("button", { name: "Next" }).click();
  await expect(chapters).toHaveCount(2);

  // The import fails once, then goes through.
  await failOn(page, "create_project", "disk full", 1);
  await dialog.getByRole("button", { name: "Import", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText("disk full");
  await dialog.getByRole("button", { name: "Import", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Import report" })).toBeVisible();
});

test("import report: warnings and notes, copying the report, and a report with notes only", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const w = window as unknown as { __clip?: string; __clipFails?: boolean };
    Object.defineProperty(navigator, "clipboard", {
      value: {
        writeText: (text: string) =>
          w.__clipFails
            ? Promise.reject(new Error("denied"))
            : ((w.__clip = text), Promise.resolve()),
      },
    });
  });
  await page.goto("/");
  await serveImports(page);
  const report = page.getByRole("dialog", { name: "Import report" });
  const runImport = async (file: string) => {
    await picks(page, file);
    const dialog = page.getByRole("dialog", { name: "Import a manuscript" });
    await dialog.getByRole("button", { name: "Choose file…" }).click();
    await expect(dialog.getByLabel("File")).not.toHaveValue("");
    await dialog.getByRole("button", { name: "Choose…" }).click();
    await expect(dialog.getByLabel("New book folder")).toHaveValue("/newbook");
    await dialog.getByRole("button", { name: "Next" }).click();
    await dialog.getByRole("button", { name: "Import", exact: true }).click();
    await expect(report).toBeVisible();
  };
  await page.getByRole("button", { name: "Import…" }).click();
  await runImport("/src/a.html");
  await expect(report.getByText("Warning", { exact: true })).toBeVisible();
  await expect(report.getByText("Note", { exact: true })).toBeVisible();
  await expect(report.getByText("Some content or formatting could not be kept.")).toBeVisible();

  await page.evaluate(() => {
    (window as unknown as { __clipFails?: boolean }).__clipFails = true;
  });
  await report.getByRole("button", { name: "Copy report" }).click();
  await expect(report.getByRole("button", { name: "Copy report" })).toBeVisible();
  await page.evaluate(() => {
    (window as unknown as { __clipFails?: boolean }).__clipFails = false;
  });
  await report.getByRole("button", { name: "Copy report" }).click();
  await expect(report.getByRole("button", { name: "Copied" })).toBeVisible();
  await expect(report.getByRole("button", { name: "Copy report" })).toBeVisible(); // back after two seconds
  expect(await page.evaluate(() => (window as unknown as { __clip?: string }).__clip)).toContain(
    "Import of a.html",
  );
  await report.getByRole("button", { name: "Done" }).click();
  await expect(report).toHaveCount(0);

  await menu(page, "file.import");
  await runImport("/src/b.html");
  await expect(report.getByText("These are routine adjustments; nothing was lost.")).toBeVisible();
  await report.getByRole("button", { name: "Copy report" }).click();
  await expect(report.getByRole("button", { name: "Copied" })).toBeVisible();
  await page.keyboard.press("Escape"); // closing with the copy note still showing resets it
  await expect(report).toHaveCount(0);
});
