import { expect, test, type Page } from "./support/coverage";
import { fakeTauri } from "./support/fakeTauri";
import { newProject } from "./support/helpers";

// The app shell: menu commands (the dev build exposes what each native menu item runs), window close, update check,
// header, sidebar, details panel and the media-query drawer.

interface ShellHooks {
  __updates?: "current" | "unsupported" | "error" | "throws";
  __pickNothing?: boolean;
  __pickRoot?: string;
  __trashError?: boolean;
  __readGate?: Promise<void>;
  __readFail?: boolean;
  __reads: number;
  __closeHandlers: ((e: unknown) => Promise<void>)[];
  __callbacks: Record<number, (e: unknown) => unknown>;
  __destroyed: number;
}
type W = Window & ShellHooks;
type MenuRun = { run: (id: string, arg?: string) => boolean };

test.beforeEach(async ({ page }) => {
  await fakeTauri(page);
  await page.addInitScript(() => {
    const w = window as unknown as W;
    w.__callbacks = {};
    w.__closeHandlers = [];
    w.__destroyed = 0;
    w.__reads = 0;
    let next = 100;
    const internals = w.__TAURI_INTERNALS__ as unknown as Record<string, unknown>;
    // The window API reads its label from here; callbacks are kept so a test can deliver a close request.
    internals.metadata = {
      currentWindow: { label: "main" },
      currentWebview: { label: "main", windowLabel: "main" },
    };
    internals.transformCallback = (cb: (e: unknown) => unknown) => {
      w.__callbacks[++next] = cb;
      return next;
    };
    const orig = w.__TAURI_INTERNALS__.invoke;
    w.__TAURI_INTERNALS__.invoke = async (cmd, a, opts) => {
      const args = a as unknown as Record<string, unknown>;
      switch (cmd) {
        case "plugin:event|listen":
          if (args.event === "tauri://close-requested")
            w.__closeHandlers.push(w.__callbacks[args.handler as number] as never);
          return orig(cmd, a, opts);
        case "plugin:window|destroy":
          w.__destroyed++;
          return null;
        case "updates_supported":
          if (w.__updates === "throws") throw "no updater";
          return w.__updates !== "unsupported";
        case "plugin:updater|check":
          if (w.__updates === "error") throw "offline";
          if (w.__updates === "unsupported") throw "unsupported updater state";
          if (w.__updates === "current") return null;
          return { available: true, version: "2.0.0", currentVersion: "1.0.0" };
        case "read_project_file":
          if (w.__readGate) {
            w.__reads++;
            await w.__readGate;
          }
          if (w.__readFail) throw { kind: "io", message: "unreadable" };
          return orig(cmd, a, opts);
        case "list_project_trash":
          if (w.__trashError) throw { kind: "io", message: "Trash unreadable" };
          return orig(cmd, a, opts);
        case "pick_reference_files":
          return w.__pickNothing ? [] : orig(cmd, a, opts);
        case "pick_font_file":
        case "pick_folder":
        case "pick_image":
        case "pick_import_source":
          if (w.__pickNothing) return null;
          if (w.__pickRoot) return w.__pickRoot;
          return orig(cmd, a, opts);
      }
      return orig(cmd, a, opts);
    };
  });
});

/** Runs a menu command like the native menu would, once it is registered and enabled. */
const runs = (page: Page, id: string, arg?: string) =>
  page.evaluate(
    ([i, a]) => {
      const m = (window as unknown as { __cadabraMenu?: MenuRun }).__cadabraMenu;
      return m ? m.run(i!, a) : false;
    },
    [id, arg] as [string, string | undefined],
  );
const menu = async (page: Page, id: string, arg?: string) => {
  await page.waitForFunction(() =>
    Boolean((window as unknown as { __cadabraMenu?: MenuRun }).__cadabraMenu),
  );
  expect(await runs(page, id, arg)).toBe(true);
};

const editor = (page: Page) => page.locator(".ProseMirror");
const notice = (page: Page) => page.locator("header [role=status]");

test("book menu commands act on the open book", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await newProject(page);
  await editor(page).click();
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.type(" words");
  await expect(page.getByText("Unsaved")).toBeVisible();
  await menu(page, "file.save");
  await expect(notice(page)).toHaveText("Saved");

  await menu(page, "insert.chapter");
  await expect(editor(page).locator("h1")).toHaveText("Chapter 2");
  await menu(page, "go.previous");
  await expect(editor(page).locator("h1")).toHaveText("Chapter One");
  await menu(page, "go.next");
  await expect(editor(page).locator("h1")).toHaveText("Chapter 2");

  await menu(page, "insert.front.title-page");
  await expect(page.getByRole("button", { name: "Title Page", exact: true })).toBeVisible();
  await menu(page, "insert.back.colophon");
  await expect(page.getByRole("button", { name: "Colophon", exact: true })).toBeVisible();
  await menu(page, "edit.bookUndo");
  await menu(page, "edit.bookRedo");

  const details = page.getByRole("complementary", { name: "Details" });
  await expect(details).toBeVisible();
  await menu(page, "view.details");
  await expect(details).toBeHidden();
  await menu(page, "view.details");
  await expect(details).toBeVisible();

  await menu(page, "view.references");
  await expect(page.getByRole("complementary", { name: "References" })).toBeVisible();
  await menu(page, "view.references");
  await expect(details).toBeVisible();

  await menu(page, "view.references");
  await expect(page.getByRole("complementary", { name: "References" })).toBeVisible();
  await menu(page, "view.references");
  await expect(details).toBeVisible();

  await menu(page, "view.focus");
  await expect(page.getByRole("button", { name: "Exit focus mode" })).toBeVisible();
  await menu(page, "view.focus");
  await expect(page.getByRole("button", { name: "Exit focus mode" })).toBeHidden();

  await menu(page, "view.read");
  // Reading shows every section that is near the viewport as its own read-only editor, so how many there are depends on layout:
  // assert on the editable ones, not on a single editor.
  await expect(editor(page).first()).toBeVisible();
  await expect(page.locator(".ProseMirror[contenteditable=true]")).toHaveCount(0);
  expect(await runs(page, "view.details")).toBe(false); // the panel belongs to writing
  await menu(page, "view.write");
  await expect(page.locator(".ProseMirror[contenteditable=true]")).toHaveCount(1);

  await menu(page, "file.bookDetails");
  await expect(page.getByRole("dialog", { name: "Book details" })).toBeVisible();
  expect(await runs(page, "file.save")).toBe(false); // a dialog is open
  await page.keyboard.press("Escape");

  for (const id of [
    "file.exportEpub",
    "file.exportPdf",
    "file.exportMarkdown",
    "file.exportDocx",
    "file.exportRtf",
    "file.exportAudiobook",
  ]) {
    await menu(page, id);
    await expect(page.getByRole("dialog", { name: "Export book" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
  }

  await menu(page, "file.printPreview");
  await expect(page.getByRole("button", { name: "Back", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Back", exact: true }).click();

  await menu(page, "help.sponsor");
  await expect.poll(() => page.evaluate(() => window.__opened?.length ?? 0)).toBe(1);

  await menu(page, "app.settings");
  await expect(page.getByRole("heading", { name: "Settings", level: 1 })).toBeVisible();
  await page.getByRole("button", { name: "Back", exact: true }).click();

  await menu(page, "file.close");
  await expect(page.getByRole("button", { name: "New project" })).toBeVisible();
});

test("Help > Check for updates reports each outcome", async ({ page }) => {
  for (const [kind, text] of [
    ["current", "CadabraCraft is up to date."],
    ["unsupported", "Your package manager updates this copy of CadabraCraft."],
    ["error", "offline"],
  ] as const) {
    await newProject(page);
    await page.evaluate((k) => ((window as unknown as W).__updates = k), kind);
    await menu(page, "help.updates");
    if (kind === "error") await expect(page.getByRole("alert")).toContainText(text);
    else await expect(notice(page)).toHaveText(text);
    await menu(page, "file.close");
    await expect(page.getByRole("button", { name: "New project" })).toBeVisible();
  }
});

test("File menu leaves the book for the start screen dialogs and reopens projects", async ({
  page,
}) => {
  await newProject(page);
  await menu(page, "file.new");
  await expect(page.getByRole("dialog", { name: "New book" })).toBeVisible();
  await page.keyboard.press("Escape");

  await page.getByRole("button", { name: "Open folder" }).click();
  await expect(editor(page).locator("h1")).toHaveText("Chapter One");
  await menu(page, "file.import");
  await expect(page.getByRole("dialog", { name: "Import a manuscript" })).toBeVisible();
  await page.keyboard.press("Escape");

  await page.getByRole("button", { name: "Open folder" }).click();
  await expect(editor(page).locator("h1")).toHaveText("Chapter One");
  await menu(page, "file.open"); // the fake folder picker answers /proj
  await expect(page.getByRole("button", { name: "New project" })).toBeHidden();
  await expect(editor(page).locator("h1")).toHaveText("Chapter One");

  await page.evaluate(() => ((window as unknown as W).__pickNothing = true));
  await menu(page, "file.open"); // cancelled: the book stays open
  await expect(editor(page).locator("h1")).toHaveText("Chapter One");
  await page.evaluate(() => ((window as unknown as W).__pickNothing = false));

  await menu(page, "file.openRecent", "/proj");
  await expect(editor(page).locator("h1")).toHaveText("Chapter One");
  expect(await runs(page, "file.openRecent")).toBe(true); // without a folder it does nothing
  await expect(editor(page).locator("h1")).toHaveText("Chapter One");

  await menu(page, "file.clearRecents");
  await menu(page, "file.close");
  await expect(page.getByRole("button", { name: "New project" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Recent projects" })).toHaveCount(0);
});

test("menu failures show in the page's error banner", async ({ page }) => {
  await newProject(page);
  await editor(page).click();
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.type("x");
  await page.evaluate(() => (window.__failWrite = () => true));
  await menu(page, "file.save");
  await expect(page.getByRole("alert")).toContainText("No space left on device");
  await menu(page, "file.close");
  await expect(page.getByRole("alert")).toContainText("No space left on device");
  await page.evaluate(() => (window.__failWrite = undefined));

  await page.evaluate(() => ((window as unknown as W).__pickRoot = "/gone"));
  await menu(page, "file.open");
  await expect(page.getByRole("alert")).toBeVisible();
  await menu(page, "file.openRecent", "/gone");
  await expect(page.getByRole("alert")).toBeVisible();
});

test("closing the window waits for the unsaved text, and a failed save keeps it open once", async ({
  page,
}) => {
  await newProject(page);
  await expect
    .poll(() => page.evaluate(() => (window as unknown as W).__closeHandlers.length))
    .toBe(1);
  const close = () =>
    page.evaluate(async () => {
      const w = window as unknown as W;
      await w.__closeHandlers[0]!({ event: "tauri://close-requested", id: 1, payload: null });
      return w.__destroyed;
    });
  expect(await close()).toBe(1); // nothing unsaved: the window just closes

  await editor(page).click();
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.type("typed");
  expect(await close()).toBe(2); // saved first, then destroyed
  await expect(notice(page)).toHaveText("Saved");

  await page.keyboard.type("more");
  await page.evaluate(() => (window.__failWrite = () => true));
  expect(await close()).toBe(2); // the save failed: the window stays open
  await expect(notice(page)).toContainText("Your last changes could not be saved");
  expect(await close()).toBe(3); // asking again leaves anyway
  await page.evaluate(() => (window.__failWrite = undefined));
  // A save no longer replaces a message the author has not dismissed.
  await page.getByRole("button", { name: "Dismiss message" }).click();
  await editor(page).click();
  await page.keyboard.press("ControlOrMeta+End");

  // The best-effort writes of a closing page.
  await page.keyboard.type("last");
  await page.evaluate(() => window.dispatchEvent(new Event("pagehide")));
  await expect(notice(page)).toHaveText("Saved");
  await page.evaluate(() => (window.__failWrite = () => true));
  await page.keyboard.type("lost");
  await page.evaluate(() => window.dispatchEvent(new Event("beforeunload")));
  await expect(page.getByText("Unsaved")).toBeVisible();
  await page.evaluate(() => (window.__failWrite = undefined));
});

test("the chapter drawer closes when the window grows to a desktop width", async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 900 });
  await newProject(page);
  await page.getByRole("button", { name: "Show chapters" }).click();
  await expect(page.getByRole("dialog", { name: "Chapters" })).toBeVisible();
  await page.setViewportSize({ width: 1280, height: 900 });
  await expect(page.getByRole("dialog", { name: "Chapters" })).toHaveCount(0);
});

test("session goal footer waits for the book count, then shows progress", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem(
      "cadabracraft.settings",
      JSON.stringify({
        sessionGoal: 500,
        typewriterScroll: false,
      }),
    );
    localStorage.setItem("cadabracraft.layout", JSON.stringify({ focus: false, details: true }));
  });
  await page.setViewportSize({ width: 1280, height: 800 });
  await newProject(page);
  await expect(page.getByTestId("session-goal")).toBeVisible({ timeout: 10_000 });
  await expect(page.getByRole("progressbar", { name: "Session goal" })).toHaveAttribute(
    "aria-valuemax",
    "500",
  );
  await expect(page.getByText(/in the book/)).toBeVisible();
});

test("a failing book word count leaves the footer without it", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await newProject(page);
  await expect(page.getByText(/in the book/)).toBeVisible({ timeout: 10_000 });
  await page.evaluate(() => ((window as unknown as W).__readFail = true));
  await page.getByRole("button", { name: "Add chapter" }).click();
  await expect(page.getByText(/in the book/)).toBeHidden({ timeout: 10_000 });
});

test("a book count that finishes after the book changed is dropped", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await newProject(page);
  await expect(page.getByText(/in the book/)).toBeVisible({ timeout: 10_000 });
  for (const fail of [false, true]) {
    await page.evaluate((f) => {
      const w = window as unknown as W;
      w.__reads = 0;
      w.__readFail = f;
      w.__readGate = new Promise<void>((r) => {
        (w as unknown as { __open: () => void }).__open = r;
      });
    }, fail);
    await page.getByRole("button", { name: "Add chapter" }).click();
    await expect
      .poll(() => page.evaluate(() => (window as unknown as W).__reads))
      .toBeGreaterThan(0);
    // The count is waiting on a page read; renaming a chapter changes the manifest under it.
    await page
      .getByRole("button", { name: /^Actions for Chapter/ })
      .first()
      .click();
    await page.getByRole("menuitem", { name: "Rename" }).click();
    await page.getByLabel("Chapter title").fill(fail ? "Second round" : "First round");
    await page.keyboard.press("Enter");
    await page.evaluate(() => (window as unknown as { __open: () => void }).__open());
    await page.evaluate(() => ((window as unknown as W).__readGate = undefined));
    await page.evaluate(() => ((window as unknown as W).__readFail = false));
    await expect(page.getByText(/in the book/)).toBeVisible({ timeout: 10_000 });
  }
});

test("the sidebar renames, reorders and reports trash errors", async ({ page }) => {
  await newProject(page);
  const row = (name: string) => page.getByRole("button", { name: `Actions for ${name}` });
  const rename = async (from: string) => {
    await row(from).click();
    await page.getByRole("menuitem", { name: "Rename" }).click();
    return page.getByLabel("Chapter title");
  };
  let input = await rename("Chapter One");
  await input.fill("   ");
  await input.blur(); // blank: keeps the old title
  await expect(page.getByRole("button", { name: "Chapter One", exact: true })).toBeVisible();
  input = await rename("Chapter One");
  await input.blur(); // unchanged
  input = await rename("Chapter One");
  await input.fill("Renamed");
  await input.press("Escape");
  input = await rename("Chapter One");
  await input.fill("Renamed");
  await input.press("Enter");
  await expect(page.getByRole("button", { name: "Renamed", exact: true })).toBeVisible();

  await page.evaluate(() => ((window as unknown as W).__trashError = true));
  await page.getByRole("button", { name: "Trash", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Trash unreadable");
  await page.keyboard.press("Escape");
});

test("a book without an author, template or cover shows dashes in the details panel", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await newProject(page);
  await page.evaluate(() => {
    const m = JSON.parse(window.__disk["cadabra.json"] as string);
    m.template = "no-such-template";
    m.editions[0].author = "Unknown";
    m.editions[0].cover = "assets/missing.png";
    window.__disk["cadabra.json"] = JSON.stringify(m);
    sessionStorage.setItem("disk", JSON.stringify(window.__disk));
  });
  await page.reload();
  await page.getByRole("button", { name: "Open folder" }).click();
  const panel = page.getByRole("complementary", { name: "Details" });
  await expect(panel.getByText("Template").locator("xpath=following-sibling::dd")).toHaveText(
    "Classic Novel",
  );
  await expect(panel.getByText("Author").locator("xpath=following-sibling::dd")).toHaveText(
    "Unknown",
  );
  await expect(panel.getByText("Cover").locator("xpath=following-sibling::dd")).toHaveText(
    "missing.png",
  );
});

test("Escape in focus mode leaves it only when nothing else is open; book undo has its shortcut", async ({
  page,
}) => {
  await newProject(page);
  await page.getByRole("button", { name: "Focus mode" }).click();
  await page.getByRole("button", { name: "Exit focus mode" }).click();
  await expect(page.getByRole("button", { name: "Focus mode" })).toBeVisible();
  await page.getByRole("button", { name: "Focus mode" }).click();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Exit focus mode" })).toBeHidden();
  await page.getByRole("button", { name: "Focus mode" }).click();
  await page.keyboard.press("a"); // any other key leaves focus mode alone
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Exit focus mode" })).toBeHidden();

  await page.getByRole("button", { name: "Focus mode" }).click();
  await menu(page, "file.bookDetails");
  await expect(page.getByRole("dialog", { name: "Book details" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Book details" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Exit focus mode" })).toBeHidden();
  await menu(page, "insert.chapter");
  await expect(editor(page).locator("h1")).toHaveText("Chapter 2");
  await menu(page, "file.bookDetails");
  await page.keyboard.press("ControlOrMeta+Alt+z"); // a dialog is open: ignored
  await page.keyboard.press("Escape");
  await page.keyboard.press("Alt+z");
  await page.keyboard.press("ControlOrMeta+Alt+x");
  await page.keyboard.press("ControlOrMeta+z");
  await expect(page.getByRole("button", { name: "Chapter 2", exact: true })).toBeVisible();
  await page.keyboard.press("ControlOrMeta+Alt+z");
  await expect(page.getByRole("button", { name: "Chapter 2", exact: true })).toHaveCount(0);
  await page.keyboard.press("ControlOrMeta+Alt+Shift+z");
  await expect(page.getByRole("button", { name: "Chapter 2", exact: true })).toBeVisible();
});

test("the phone header keeps its actions in the More actions menu", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await newProject(page);
  await editor(page).click();
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.type("phone");
  const more = page.getByRole("button", { name: "More actions" });
  await more.click();
  await page.getByRole("menuitem", { name: "Save" }).click();
  await expect(notice(page)).toHaveText("Saved");
  await more.click();
  await page.getByRole("menuitem", { name: "Export" }).click();
  await expect(page.getByRole("dialog", { name: "Export book" })).toBeVisible();
  await page.keyboard.press("Escape");
  await more.click();
  await page.getByRole("menuitem", { name: "Book details" }).click();
  await expect(page.getByRole("dialog", { name: "Book details" })).toBeVisible();
  await page.keyboard.press("Escape");
  await menu(page, "view.read");
  await more.click();
  await expect(page.getByRole("menuitem", { name: "Save" })).toHaveCount(0);
  await page.keyboard.press("Escape");
  await menu(page, "view.write");
  await more.click();
  await page.getByRole("menuitem", { name: "Settings" }).click();
  await expect(page.getByRole("heading", { name: "Settings", level: 1 })).toBeVisible();
});
