import { expect, test, type Page } from "@playwright/test";

// The Tauri backend is replaced with an in-memory fake of the same commands (persisted in sessionStorage so
// reloads work), so the real UI, TipTap editor, store and EPUB exporter run in a plain browser.
// Backend behaviour is covered by the Rust tests in src-tauri/src/project.
async function fakeTauri(page: Page) {
  await page.addInitScript(() => {
    const PIXEL = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
    // UI language is an app preference; specs assert English text unless a test picks another locale first.
    if (!localStorage.getItem("cadabracraft.locale")) localStorage.setItem("cadabracraft.locale", "en");
    const disk: Record<string, string | number[]> = JSON.parse(sessionStorage.getItem("disk") ?? "{}");
    const persist = () => sessionStorage.setItem("disk", JSON.stringify(disk));
    const h = (s: string) => `${s.length}:${s.slice(0, 50)}`;
    (window as any).__disk = disk;
    (window as any).__TAURI_INTERNALS__ = {
      transformCallback: () => 0,
      invoke: async (cmd: string, a: any) => {
        switch (cmd) {
          // The image picker passes extension filters; the folder picker does not.
          case "plugin:dialog|open": return a?.options?.filters ? "/pics/pic.png" : "/proj";
          case "plugin:event|listen": return 1;
          case "plugin:event|unlisten": return null;
          case "watch_project": return null;
          case "create_project": disk["cadabra.json"] = a.manifestJson; persist(); return null;
          case "read_project_file": if (a.root === "/gone") return null; return typeof disk[a.path] === "string" ? { contents: disk[a.path], hash: h(disk[a.path] as string) } : null;
          case "write_project_file": disk[a.path] = a.contents; persist(); return { hash: h(a.contents), conflict_copy: null };
          case "write_project_bytes": disk[a.path] = a.bytes; persist(); return null;
          case "import_asset":
            if ((window as any).__importError) throw (window as any).__importError;
            disk["assets/pic.png"] = Array.from(atob(PIXEL), (c) => c.charCodeAt(0));
            persist();
            return "assets/pic.png";
          case "read_asset":
            if (!Array.isArray(disk[a.path])) throw `missing ${a.path}`;
            return disk[a.path];
          case "typst_list_fonts":
            if ((window as any).__typstError) throw (window as any).__typstError;
            return ["Libertinus Serif", "New Computer Modern"];
          case "typst_compile":
            ((window as any).__typstCalls ??= []).push(a);
            if ((window as any).__compileError) throw (window as any).__compileError;
            return new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]).buffer;
          case "backup_manifest": return "backup";
          // Same naming as the Rust command: .cadabra/trash/<stamp>-<path with / as __>.
          case "trash_project_file": {
            const base = `.cadabra/trash/20260101-1200-${a.path.replaceAll("/", "__")}`;
            let to = base; // like the Rust command, never overwrite an earlier trashed file
            for (let n = 2; to in disk; n++) to = base.replace(/\.json$/, `-${n}.json`);
            disk[to] = disk[a.path]!; delete disk[a.path]; persist(); return to;
          }
          case "list_project_trash":
            return Object.keys(disk).filter((k) => /^\.cadabra\/trash\/\d{8}-\d{4}-/.test(k)).map((k) => ({ path: k, original: k.slice(29).replaceAll("__", "/"), trashed_at: "20260101-1200" }));
          case "restore_project_trash": {
            let to = a.path.slice(29).replaceAll("__", "/");
            for (let n = 2; to in disk; n++) to = a.path.slice(29).replaceAll("__", "/").replace(/\.json$/, `-${n}.json`);
            disk[to] = disk[a.path]!; delete disk[a.path]; persist(); return to;
          }
        }
        throw new Error(`unexpected command ${cmd}`);
      },
    };
  });
}

async function newProject(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "New project" }).click();
  const dialog = page.getByRole("dialog", { name: "New book" });
  await dialog.getByLabel("Title").fill("E2E Book");
  await dialog.getByLabel("Author").fill("Tester");
  await dialog.getByRole("button", { name: "Choose…" }).click();
  await expect(dialog.getByLabel("Folder")).toHaveValue("/proj");
  await dialog.getByRole("button", { name: "Create book" }).click();
  await expect(page.locator(".ProseMirror h1")).toHaveText("Chapter One");
}
const titles = (page: Page) => page.getByRole("navigation", { name: "Chapters" }).locator("li > button[aria-current='true']").allTextContents();

async function chapterAction(page: Page, chapter: string, item: string) {
  await page.getByRole("button", { name: `Actions for ${chapter}` }).click();
  await page.getByRole("menuitem", { name: item }).click();
}

test.beforeEach(async ({ page }) => {
  await fakeTauri(page);
});

test("creating a project shows a first chapter in the editor", async ({ page }) => {
  await newProject(page);
  expect(await titles(page)).toEqual(["Chapter One"]);
  await expect(page.locator(".ProseMirror h1")).toHaveText("Chapter One");
  const manifest = await page.evaluate(() => JSON.parse((window as any).__disk["cadabra.json"]));
  expect(manifest).toMatchObject({ formatVersion: 2, title: "E2E Book", author: "Tester" });
});

test("typed text is saved as TipTap JSON and survives a reload via Open", async ({ page }) => {
  await newProject(page);
  await page.locator(".ProseMirror").click();
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.type("Hello from Playwright");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("status")).toHaveText("Saved");
  await page.reload();
  await page.getByRole("button", { name: "Open folder" }).click();
  await expect(page.locator(".ProseMirror")).toContainText("Hello from Playwright");
});

test("switching chapters keeps unsaved typing", async ({ page }) => {
  await newProject(page);
  await page.locator(".ProseMirror").click();
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.type("first chapter text");
  await page.getByRole("button", { name: "Add chapter" }).click();
  await expect(page.locator(".ProseMirror h1")).toHaveText("Chapter 2");
  await page.getByRole("button", { name: "Chapter One", exact: true }).click();
  await expect(page.locator(".ProseMirror")).toContainText("first chapter text");
});

test("rename, reorder and delete chapters", async ({ page }) => {
  await newProject(page);
  await page.getByRole("button", { name: "Add chapter" }).click();
  await chapterAction(page, "Chapter 2", "Rename");
  await page.getByLabel("Chapter title").fill("Second");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("button", { name: "Second", exact: true })).toBeVisible();

  await chapterAction(page, "Second", "Move up");
  const order = await page.evaluate(() => JSON.parse((window as any).__disk["cadabra.json"]).chapters.map((c: any) => c.title));
  expect(order).toEqual(["Second", "Chapter One"]);

  await chapterAction(page, "Second", "Move to trash");
  await page.getByRole("dialog").getByRole("button", { name: "Move to trash" }).click();
  await expect(page.getByRole("button", { name: "Second", exact: true })).toHaveCount(0);
  const trashed = await page.evaluate(() => Object.keys((window as any).__disk).filter((k) => k.startsWith(".cadabra/trash/")));
  expect(trashed).toHaveLength(1);
});

test("keyboard: chapter controls are reachable with Tab", async ({ page }) => {
  await newProject(page);
  await page.getByRole("button", { name: "Chapter One", exact: true }).focus();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "Actions for Chapter One" })).toBeFocused();
});

test("export writes a valid EPUB zip with mimetype first", async ({ page }) => {
  await newProject(page);
  await exportBook(page, "EPUB 3");
  await expect(page.getByRole("status")).toHaveText("Exported exports/book.epub");
  const head = await page.evaluate(() => {
    const b = (window as any).__disk["exports/book.epub"] as number[];
    return String.fromCharCode(...b.slice(0, 4), ...b.slice(30, 38));
  });
  expect(head).toBe("PK\u0003\u0004mimetype");
});

test.describe("images", () => {
  const tb = (page: Page, name: string) => page.getByRole("toolbar", { name: "Formatting" }).getByRole("button", { name, exact: true });

  test("inserts an imported image with alt and caption, shows it, saves a relative path and exports it", async ({ page }) => {
    await newProject(page);
    await page.locator(".ProseMirror p").last().click();
    await tb(page, "Image").click();
    const dialog = page.getByRole("dialog", { name: "Add image" });
    await expect(dialog.getByLabel("Image file")).toHaveValue("assets/pic.png");
    await dialog.getByLabel("Description (alt text)").fill("A single pixel");
    await dialog.getByLabel("Caption").fill("Figure one");
    await dialog.getByRole("button", { name: "Insert" }).click();

    const img = page.locator(".ProseMirror figure img");
    await expect(img).toHaveAttribute("alt", "A single pixel");
    await expect(img).toHaveAttribute("src", /^blob:/);
    await expect.poll(() => img.evaluate((i: HTMLImageElement) => i.complete && i.naturalWidth)).toBe(1);
    await expect(page.locator(".ProseMirror figure figcaption")).toHaveText("Figure one");

    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByRole("status")).toHaveText("Saved");
    const saved = await page.evaluate(() => (window as any).__disk["manuscript/001-chapter-one.json"] as string);
    expect(JSON.parse(saved).content.find((n: any) => n.type === "image").attrs).toMatchObject({ src: "assets/pic.png", alt: "A single pixel", title: "Figure one" });
    expect(saved).not.toContain("blob:");

    await exportBook(page, "EPUB 3");
    await expect(page.getByRole("status")).toHaveText("Exported exports/book.epub");
    const zipText = await page.evaluate(() => String.fromCharCode(...((window as any).__disk["exports/book.epub"] as number[])));
    expect(zipText).toContain("OEBPS/assets/pic.png");

    // Reopening resolves the stored relative path again.
    await page.reload();
    await page.getByRole("button", { name: "Open folder" }).click();
    await expect(page.locator(".ProseMirror figure img")).toHaveAttribute("src", /^blob:/);
  });

  test("a refused image shows a message and inserts nothing", async ({ page }) => {
    await newProject(page);
    await page.evaluate(() => { (window as any).__importError = "pic.png is larger than 25 MB"; });
    await tb(page, "Image").click();
    await expect(page.getByRole("status")).toContainText("Could not add the image: pic.png is larger than 25 MB");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.locator(".ProseMirror figure")).toHaveCount(0);
  });
});

test.describe("formatting toolbar", () => {
  const ed = (page: Page) => page.locator(".ProseMirror");
  const tb = (page: Page, name: string) => page.getByRole("toolbar", { name: "Formatting" }).getByRole("button", { name, exact: true });
  async function typeLine(page: Page, text: string) {
    // The new chapter ends with an empty paragraph; click it rather than rely on platform-specific End shortcuts.
    await ed(page).locator("p").last().click();
    await page.keyboard.type(text);
  }
  // Triple-click selects the paragraph; Shift+Home is platform-specific in Chromium.
  const selectLine = async (page: Page) => { await ed(page).locator("p").last().click({ clickCount: 3 }); };

  test.beforeEach(async ({ page }) => { await newProject(page); });

  test("bold, italic, underline and small caps wrap the selection", async ({ page }) => {
    await typeLine(page, "styled");
    for (const [name, sel] of [["Bold", "strong"], ["Italic", "em"], ["Underline", "u"], ["Small caps", "span.small-caps"]] as const) {
      await selectLine(page);
      await tb(page, name).click();
      await expect(tb(page, name)).toHaveAttribute("aria-pressed", "true");
      await expect(ed(page).locator(sel)).toHaveText("styled");
    }
  });

  test("headings, quote and lists change the block type", async ({ page }) => {
    await typeLine(page, "block");
    await tb(page, "Heading 2").click();
    await expect(ed(page).locator("h2")).toHaveText("block");
    await tb(page, "Heading 2").click();
    await tb(page, "Block quote").click();
    await expect(ed(page).locator("blockquote")).toContainText("block");
    await tb(page, "Block quote").click();
    await tb(page, "Bulleted list").click();
    await expect(ed(page).locator("ul li")).toContainText("block");
    await tb(page, "Numbered list").click();
    await expect(ed(page).locator("ol li")).toContainText("block");
  });

  test("scene break and footnote insert, and export contains them", async ({ page }) => {
    await typeLine(page, "text");
    await tb(page, "Scene break").click();
    await expect(ed(page).locator("hr.scene-break")).toHaveCount(1);
    await tb(page, "Footnote").click();
    await expect(ed(page).locator("span.footnote")).toHaveCount(1);
    await exportBook(page, "EPUB 3");
    await expect(page.getByRole("status")).toHaveText("Exported exports/book.epub");
    const saved = await page.evaluate(() => (window as any).__disk["manuscript/001-chapter-one.json"]);
    expect(saved).toContain("sceneBreak");
    expect(saved).toContain("footnote");
  });

  test("links accept https and refuse javascript:", async ({ page }) => {
    await typeLine(page, "click me");
    await selectLine(page);
    await tb(page, "Link").click();
    const dialog = page.getByRole("dialog", { name: "Add link" });
    await dialog.getByLabel("Address").fill("javascript:alert(1)");
    await dialog.getByRole("button", { name: "Apply" }).click();
    await expect(dialog.getByRole("alert")).toBeVisible(); // refused, dialog stays open
    await expect(ed(page).locator("a")).toHaveCount(0);
    await dialog.getByLabel("Address").fill("example.com");
    await dialog.getByRole("button", { name: "Apply" }).click();
    await expect(ed(page).locator("a")).toHaveAttribute("href", "https://example.com/");
    await tb(page, "Link").click(); // toggles off
    await expect(ed(page).locator("a")).toHaveCount(0);
  });

  test("undo and redo are available from the toolbar", async ({ page }) => {
    await typeLine(page, "oops");
    await tb(page, "Undo").click();
    await expect(ed(page)).not.toContainText("oops");
    await tb(page, "Redo").click();
    await expect(ed(page)).toContainText("oops");
  });
});

test("dark theme is applied and remembered", async ({ page }) => {
  await newProject(page);
  await page.getByRole("button", { name: "Settings" }).click();
  await page.getByRole("radio", { name: "Dark" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
});

test("phone layout reaches chapters through the sheet", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await newProject(page);
  await expect(page.getByRole("navigation", { name: "Chapters" })).toHaveCount(0);
  const toolbar = await page.getByRole("toolbar", { name: "Formatting" }).boundingBox();
  const editorBox = await page.locator(".ProseMirror").boundingBox();
  expect(toolbar!.y).toBeGreaterThan(editorBox!.y); // docked below the page on phones
  await page.getByRole("button", { name: "Show chapters" }).click();
  await page.getByRole("button", { name: "Add chapter" }).click();
  await expect(page.locator(".ProseMirror h1")).toHaveText("Chapter 2");
  await page.getByRole("button", { name: "Chapter One", exact: true }).click();
  await expect(page.getByRole("navigation", { name: "Chapters" })).toHaveCount(0);
  await expect(page.locator(".ProseMirror h1")).toHaveText("Chapter One");
});

test("word count follows typing", async ({ page }) => {
  await newProject(page);
  await expect(page.getByText("2 words in this chapter")).toBeVisible(); // the "Chapter One" heading
  await page.locator(".ProseMirror").click();
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.type("one two three");
  await expect(page.getByText("5 words in this chapter")).toBeVisible();
});

test("reading mode is read-only, shows unsaved typing and moves between chapters", async ({ page }) => {
  await newProject(page);
  await page.getByRole("button", { name: "Add chapter" }).click();
  await page.getByRole("button", { name: "Chapter One", exact: true }).click();
  await page.locator(".ProseMirror").click();
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.type("Hello reading");
  await page.getByRole("radio", { name: "Read" }).click();
  await expect(page.locator(".ProseMirror")).toContainText("Hello reading");
  await expect(page.locator(".ProseMirror")).toHaveAttribute("contenteditable", "false");
  await expect(page.getByRole("toolbar", { name: "Formatting" })).toHaveCount(0);
  await expect(page.getByText("Chapter 1 of 2")).toBeVisible();
  await page.getByRole("button", { name: "Next chapter" }).click();
  await expect(page.locator(".ProseMirror h1")).toHaveText("Chapter 2");
  await expect(page.getByText("Chapter 2 of 2")).toBeVisible();
  await page.getByRole("button", { name: "Reading settings" }).click();
  await page.getByRole("menuitem", { name: "Larger text" }).click();
  await page.keyboard.press("Escape");
  await page.getByRole("radio", { name: "Write" }).click();
  await expect(page.getByRole("toolbar", { name: "Formatting" })).toBeVisible();
  const saved = await page.evaluate(() => Object.values((window as any).__disk).filter((v) => typeof v === "string").join("\n"));
  expect(saved).toContain("Hello reading");
});

test("language picker switches the UI to the pseudo-locale and remembers it", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page.locator("html")).toHaveAttribute("dir", "ltr");
  await page.getByRole("button", { name: "Settings" }).click();
  await page.getByLabel("Interface language").selectOption("pseudo");
  await expect(page.getByRole("heading", { level: 1 })).not.toHaveText("Settings");
  await page.reload();
  await expect(page.getByRole("heading", { level: 1 })).not.toHaveText("Settings");
  expect(await page.evaluate(() => localStorage.getItem("cadabracraft.locale"))).toBe("pseudo");
});

test("Export PDF sends the chosen options to Typst and writes exports/book.pdf", async ({ page }) => {
  await newProject(page);
  await page.locator(".ProseMirror").click();
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.type("Typeset me");
  await page.getByRole("button", { name: "Export", exact: true }).click();
  await page.getByRole("dialog", { name: "Export book" }).getByRole("radio", { name: "Print PDF" }).click();
  const dialog = page.getByRole("dialog", { name: "Export book" });
  await dialog.getByLabel("Trim size").selectOption("5x8");
  await dialog.getByLabel("Template").selectOption("nonfiction");
  await dialog.getByLabel("PDF/A (archival)").check();
  await dialog.getByRole("button", { name: "Export", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole("status")).toHaveText("Exported exports/book.pdf");

  const call = await page.evaluate(() => (window as any).__typstCalls[0]);
  expect(call.pdfA).toBe(true);
  expect(call.source).toContain("Typeset me"); // unsaved typing was flushed first
  expect(call.source).toMatch(/#set page\(width: 5in, height: 8in/); // 5x8 trim
  const pdf = await page.evaluate(() => (window as any).__disk["exports/book.pdf"]);
  expect(pdf).toEqual([0x25, 0x50, 0x44, 0x46, 0x2d]);
  const manifest = await page.evaluate(() => JSON.parse((window as any).__disk["cadabra.json"]));
  expect(manifest.template).toBe("nonfiction");
});

test("Export PDF explains when Typst is missing and offers a location field", async ({ page }) => {
  await newProject(page);
  await page.evaluate(() => { (window as any).__typstError = { kind: "not_found", message: 'The "typst" program was not found. Install Typst (brew install typst).' }; });
  await page.getByRole("button", { name: "Export", exact: true }).click();
  await page.getByRole("dialog", { name: "Export book" }).getByRole("radio", { name: "Print PDF" }).click();
  const dialog = page.getByRole("dialog", { name: "Export book" });
  await dialog.getByRole("button", { name: "Export", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText("brew install typst");
  await expect(dialog.getByLabel("Typst location (optional)")).toBeVisible();
  expect(await page.evaluate(() => (window as any).__disk["exports/book.pdf"])).toBeUndefined();
});

test("Export PDF shows Typst's compile error", async ({ page }) => {
  await newProject(page);
  await page.evaluate(() => { (window as any).__compileError = { kind: "compile", message: "main.typ:4:2: error: boom" }; });
  await page.getByRole("button", { name: "Export", exact: true }).click();
  await page.getByRole("dialog", { name: "Export book" }).getByRole("radio", { name: "Print PDF" }).click();
  const dialog = page.getByRole("dialog", { name: "Export book" });
  await dialog.getByRole("button", { name: "Export", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText("main.typ:4:2: error: boom");
  await expect(dialog.getByRole("button", { name: "Export", exact: true })).toBeEnabled();
});

async function addPage(page: Page, name: string) {
  await page.getByRole("button", { name: "Add page" }).click();
  await page.getByRole("menuitem", { name, exact: true }).click();
}
const manifestOf = (page: Page) => page.evaluate(() => JSON.parse((window as any).__disk["cadabra.json"]));
const sidebar = (page: Page) => page.getByRole("navigation", { name: "Chapters" });

test("add front and back matter pages with generated content, and they open in the editor", async ({ page }) => {
  await newProject(page);
  await addPage(page, "Title page");
  await expect(page.locator(".ProseMirror h1")).toHaveText("E2E Book");
  await expect(page.locator(".ProseMirror")).toContainText("Tester");
  await expect(sidebar(page).getByRole("heading", { name: "Front matter" })).toBeVisible();
  await addPage(page, "Copyright page");
  await expect(page.locator(".ProseMirror")).toContainText("All rights reserved.");
  await addPage(page, "About the author");
  await expect(page.locator(".ProseMirror h1")).toHaveText("About the Author");
  await expect(sidebar(page).getByRole("heading", { name: "Back matter" })).toBeVisible();
  const m = await manifestOf(page);
  expect(m.frontMatter.map((e: any) => [e.kind, e.file])).toEqual([["title-page", "front-matter/01-title-page.json"], ["copyright", "front-matter/02-copyright.json"]]);
  expect(m.backMatter.map((e: any) => e.kind)).toEqual(["about-the-author"]);
  // selecting any entry opens the editor on it
  await sidebar(page).getByRole("button", { name: "Title Page", exact: true }).click();
  await expect(page.locator(".ProseMirror h1")).toHaveText("E2E Book");
  await expect(page.getByText("Front matter", { exact: true }).last()).toBeVisible();
});

test("title page and copyright page can only be added once", async ({ page }) => {
  await newProject(page);
  await addPage(page, "Title page");
  await page.getByRole("button", { name: "Add page" }).click();
  await expect(page.getByRole("menuitem", { name: "Title page", exact: true })).toHaveAttribute("data-disabled", "");
  await expect(page.getByRole("menuitem", { name: "Copyright page", exact: true })).not.toHaveAttribute("data-disabled", "");
  await expect(page.getByRole("menuitem", { name: "Dedication", exact: true })).not.toHaveAttribute("data-disabled", "");
});

test("rename, reorder and delete front and back matter", async ({ page }) => {
  await newProject(page);
  await addPage(page, "Dedication");
  await addPage(page, "Foreword");
  await chapterAction(page, "Foreword", "Rename");
  await page.getByLabel("Page title").fill("Words Before");
  await page.keyboard.press("Enter");
  await expect(sidebar(page).getByRole("button", { name: "Words Before", exact: true })).toBeVisible();
  await chapterAction(page, "Words Before", "Move up");
  expect((await manifestOf(page)).frontMatter.map((e: any) => e.title)).toEqual(["Words Before", "Dedication"]);
  await page.getByRole("button", { name: "Actions for Words Before" }).click();
  await expect(page.getByRole("menuitem", { name: "Move up" })).toHaveAttribute("data-disabled", "");
  await page.keyboard.press("Escape");

  await addPage(page, "Acknowledgments");
  await addPage(page, "Colophon");
  await chapterAction(page, "Colophon", "Move up");
  expect((await manifestOf(page)).backMatter.map((e: any) => e.kind)).toEqual(["colophon", "acknowledgments"]);

  await chapterAction(page, "Dedication", "Move to trash");
  await page.getByRole("dialog").getByRole("button", { name: "Move to trash" }).click();
  await expect(sidebar(page).getByRole("button", { name: "Dedication", exact: true })).toHaveCount(0);
  const trashed = await page.evaluate(() => Object.keys((window as any).__disk).filter((k) => k.startsWith(".cadabra/trash/")));
  expect(trashed).toEqual([".cadabra/trash/20260101-1200-front-matter__01-dedication.json"]);
  expect((await manifestOf(page)).chapters).toHaveLength(1); // chapters untouched
});

test("keyboard: the Add page menu opens and selects with the keyboard", async ({ page }) => {
  await newProject(page);
  await page.getByRole("button", { name: "Add page" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("menu")).toBeVisible();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await expect(page.locator(".ProseMirror h1")).toHaveText("E2E Book");
});

test("EPUB and PDF exports include the matter pages", async ({ page }) => {
  await newProject(page);
  await addPage(page, "Title page");
  await addPage(page, "Acknowledgments");
  await exportBook(page, "EPUB 3");
  await expect(page.getByRole("status")).toHaveText("Exported exports/book.epub");
  const names = await page.evaluate(() => {
    const b = (window as any).__disk["exports/book.epub"] as number[];
    return String.fromCharCode(...b).match(/OEBPS\/(fm|bm|ch)-\d+\.xhtml/g);
  });
  expect([...new Set(names)].sort()).toEqual(["OEBPS/bm-1.xhtml", "OEBPS/ch-1.xhtml", "OEBPS/fm-1.xhtml"]);
  await page.getByRole("button", { name: "Export", exact: true }).click();
  await page.getByRole("dialog", { name: "Export book" }).getByRole("radio", { name: "Print PDF" }).click();
  await page.getByRole("dialog", { name: "Export book" }).getByRole("button", { name: "Export", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("Exported exports/book.pdf");
  const source: string = await page.evaluate(() => (window as any).__typstCalls[0].source);
  expect(source).toContain("#title-page[");
  expect(source).toContain('#chapter-start("Acknowledgments", none)');
});

test("restoring a page from the trash puts it back at the end and opens it", async ({ page }) => {
  await newProject(page);
  await page.getByRole("button", { name: "Add chapter" }).click();
  await expect(page.locator(".ProseMirror h1")).toHaveText("Chapter 2");
  await chapterAction(page, "Chapter 2", "Move to trash");
  await page.getByRole("dialog").getByRole("button", { name: "Move to trash" }).click();
  await expect(page.getByRole("button", { name: "Chapter 2", exact: true })).toHaveCount(0);
  // A new chapter takes the freed file name, so the restored page must not overwrite it.
  await page.getByRole("button", { name: "Add chapter" }).click();
  await expect(page.locator(".ProseMirror h1")).toHaveText("Chapter 2");
  await page.locator(".ProseMirror").click();
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.type("new one");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("status")).toHaveText("Saved");

  await page.getByRole("button", { name: "Trash", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Trash" });
  await expect(dialog.getByText("Chapter 2")).toBeVisible();
  await dialog.getByRole("button", { name: "Restore Chapter 2" }).click();
  await expect(dialog).toHaveCount(0);

  const manifest = await page.evaluate(() => JSON.parse((window as any).__disk["cadabra.json"]));
  expect(manifest.chapters.map((c: any) => c.title)).toEqual(["Chapter One", "Chapter 2", "Chapter 2"]);
  const files: string[] = manifest.chapters.map((c: any) => c.file);
  expect(new Set(files).size).toBe(3);
  const disk = await page.evaluate(() => (window as any).__disk as Record<string, string>);
  expect(disk[files[1]!]).toContain("new one");
  expect(Object.keys(disk).filter((k) => k.startsWith(".cadabra/trash/"))).toEqual([]);
  await expect(page.getByRole("button", { name: "Chapter 2", exact: true })).toHaveCount(2);
  expect(await titles(page)).toEqual(["Chapter 2"]);

  await page.getByRole("button", { name: "Trash", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Trash" }).getByText("The trash is empty.")).toBeVisible();
});

test("recent projects: listed after opening, reopenable, removable, and missing folders are flagged", async ({ page }) => {
  await newProject(page);
  await page.reload();
  const recent = page.getByRole("region", { name: "Recent projects" });
  await expect(recent.getByText("E2E Book")).toBeVisible();
  // Never written into the project file.
  expect(await page.evaluate(() => (window as any).__disk["cadabra.json"])).not.toContain("/proj");
  await recent.getByRole("button", { name: /E2E Book/ }).first().click();
  await expect(page.locator(".ProseMirror h1")).toHaveText("Chapter One");

  await page.evaluate(() => localStorage.setItem("cadabracraft.recents", JSON.stringify([
    { root: "/gone", title: "Moved Book", openedAt: 2 }, { root: "/proj", title: "E2E Book", openedAt: 1 },
  ])));
  await page.reload();
  await recent.getByRole("button", { name: /Moved Book/ }).first().click();
  await expect(recent.getByText("Folder not found.")).toBeVisible();
  await page.getByRole("button", { name: "Remove Moved Book from recent projects" }).click();
  await expect(recent.getByText("Moved Book")).toHaveCount(0);
  await expect(recent.getByText("E2E Book")).toBeVisible();
});

test("focus mode hides the chrome, exits with Escape and is remembered", async ({ page }) => {
  await newProject(page);
  await expect(page.getByRole("navigation", { name: "Chapters" })).toBeVisible();
  await page.getByRole("button", { name: "Focus mode" }).click();
  await expect(page.getByRole("navigation", { name: "Chapters" })).toBeHidden();
  await expect(page.getByRole("button", { name: "Export", exact: true })).toBeHidden();
  await page.reload();
  await page.getByRole("button", { name: "Open folder" }).click();
  await expect(page.getByRole("button", { name: "Exit focus mode" })).toBeVisible();
  await page.locator(".ProseMirror").click();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Exit focus mode" })).toBeHidden();
  await expect(page.getByRole("navigation", { name: "Chapters" })).toBeVisible();
});

test("details panel shows page and book facts on desktop and can be hidden", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await newProject(page);
  const panel = page.getByRole("complementary", { name: "Details" });
  await expect(panel).toContainText("E2E Book");
  await expect(panel).toContainText("Tester");
  await expect(panel).toContainText("Chapter One");
  await page.locator(".ProseMirror").click();
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.type("alpha beta gamma");
  await expect(panel.getByText("Words").locator("xpath=following-sibling::dd")).not.toHaveText("0");
  await page.getByRole("button", { name: "Details" }).click();
  await expect(panel).toBeHidden();
});

test("book undo and redo: sidebar buttons and shortcut, trash round trip, separate from editor undo", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await newProject(page);
  const nav = page.getByRole("navigation", { name: "Chapters" });
  const undo = nav.getByRole("button", { name: /^Undo/ });
  const redo = nav.getByRole("button", { name: /^Redo/ });
  await expect(undo).toBeDisabled();
  await expect(redo).toBeDisabled();
  const chapters = () => page.evaluate(() => JSON.parse((window as any).__disk["cadabra.json"]).chapters.map((c: any) => c.title));
  const trashCount = () => page.evaluate(() => Object.keys((window as any).__disk).filter((k) => k.startsWith(".cadabra/trash/")).length);

  await page.getByRole("button", { name: "Add chapter" }).click();
  await expect(page.locator(".ProseMirror h1")).toHaveText("Chapter 2");
  await expect(undo).toHaveAccessibleName("Undo: Add Chapter 2");
  // Removing then undoing brings the page back from the trash.
  await chapterAction(page, "Chapter 2", "Move to trash");
  await page.getByRole("dialog").getByRole("button", { name: "Move to trash" }).click();
  expect(await chapters()).toEqual(["Chapter One"]);
  expect(await trashCount()).toBe(1);
  await undo.click();
  expect(await chapters()).toEqual(["Chapter One", "Chapter 2"]);
  expect(await trashCount()).toBe(0);
  await expect(page.locator(".ProseMirror h1")).toHaveText("Chapter 2");
  await expect(redo).toBeEnabled();
  await redo.click();
  expect(await chapters()).toEqual(["Chapter One"]);
  expect(await trashCount()).toBe(1);

  // Keyboard: Mod+Alt+Z undoes the book edit; Mod+Z in the editor only undoes typing.
  await page.locator(".ProseMirror").click();
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.type(" typed");
  await page.keyboard.press("ControlOrMeta+z");
  await expect(page.locator(".ProseMirror h1")).toHaveText("Chapter One");
  expect(await chapters()).toEqual(["Chapter One"]); // editor undo did not touch the tree
  await page.keyboard.press("ControlOrMeta+Alt+z");
  await expect(page.getByRole("button", { name: "Chapter 2", exact: true })).toBeVisible();
  expect(await chapters()).toEqual(["Chapter One", "Chapter 2"]);
  await page.keyboard.press("ControlOrMeta+Alt+Shift+z");
  await expect(page.getByRole("button", { name: "Chapter 2", exact: true })).toHaveCount(0);
  expect(await trashCount()).toBe(1);

  // Undoing an add trashes, never deletes.
  await page.getByRole("button", { name: "Add chapter" }).click();
  await expect(redo).toBeDisabled();
  await undo.click();
  await expect.poll(trashCount).toBe(2);
});

test("details panel is not shown on a tablet", async ({ page }) => {
  await page.setViewportSize({ width: 820, height: 1180 });
  await newProject(page);
  await expect(page.getByRole("complementary", { name: "Details" })).toBeHidden();
});

async function exportBook(page: Page, format: "EPUB 3" | "Print PDF") {
  await page.getByRole("button", { name: "Export", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Export book" });
  await dialog.getByRole("radio", { name: format }).click();
  await dialog.getByRole("button", { name: "Export", exact: true }).click();
  await expect(dialog).toHaveCount(0);
}

test("settings change the writing width and remember it", async ({ page }) => {
  await newProject(page);
  await page.getByRole("button", { name: "Settings" }).click();
  await page.getByRole("radio", { name: "Wide" }).click();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("cadabracraft.settings") ?? "{}").writingWidth)).toBe("wide");
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await expect(page.locator(".ProseMirror")).toBeVisible();
});

test("templates page sets the book's template from the details panel", async ({ page }) => {
  await newProject(page);
  await page.getByRole("button", { name: "Change template" }).click();
  await expect(page.getByRole("heading", { name: "Choose a look for your book" })).toBeVisible();
  await page.getByRole("button", { name: /^Poetry/ }).click();
  await page.getByRole("button", { name: "Use template" }).click();
  await expect(page.getByRole("navigation", { name: "Chapters" })).toBeVisible();
  const manifest = await page.evaluate(() => JSON.parse((window as any).__disk["cadabra.json"]));
  expect(manifest.template).toBe("poetry");
});

test("print preview opens from the export dialog and returns to the book", async ({ page }) => {
  await newProject(page);
  await page.getByRole("button", { name: "Export", exact: true }).click();
  await page.getByRole("dialog", { name: "Export book" }).getByRole("button", { name: "Print preview" }).click();
  await expect(page.getByRole("heading", { name: "Print preview" })).toBeVisible();
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await expect(page.locator(".ProseMirror")).toBeVisible();
});
