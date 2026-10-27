import { expect, test, type Page } from "@playwright/test";

// The Tauri backend is replaced with an in-memory fake of the same commands (persisted in sessionStorage so
// reloads work), so the real UI, TipTap editor, store and EPUB exporter run in a plain browser.
// Backend behaviour is covered by the Rust tests in src-tauri/src/project.
async function fakeTauri(page: Page) {
  await page.addInitScript(() => {
    const PIXEL = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
    // UI language is an app preference; specs assert English text unless a test picks another locale first.
    if (!localStorage.getItem("cadabracraft.locale")) localStorage.setItem("cadabracraft.locale", "en");
    // The sponsor dialog after an export is off unless a test turns it on (it would cover the page in every export test).
    if (!sessionStorage.getItem("sponsorTest")) localStorage.setItem("cadabracraft.sponsor", "hidden");
    const disk: Record<string, string | number[]> = JSON.parse(sessionStorage.getItem("disk") ?? "{}");
    const persist = () => sessionStorage.setItem("disk", JSON.stringify(disk));
    const h = (s: string) => `${s.length}:${s.slice(0, 50)}`;
    (window as any).__disk = disk;
    (window as any).__TAURI_INTERNALS__ = {
      transformCallback: () => 0,
      invoke: async (cmd: string, a: any, opts?: any) => {
        switch (cmd) {
          // The image picker passes extension filters; the folder picker does not.
          case "plugin:dialog|open": return a?.options?.filters ? "/pics/pic.png" : "/proj";
          case "plugin:opener|open_url": ((window as any).__opened ??= []).push(a.url); return null;
          case "plugin:event|listen": return 1;
          case "plugin:event|unlisten": return null;
          case "watch_project": return null;
          case "create_project": disk["cadabra.json"] = a.manifestJson; persist(); return null;
          case "read_project_file": if (a.root === "/gone") return null; return typeof disk[a.path] === "string" ? { contents: disk[a.path], hash: h(disk[a.path] as string) } : null;
          case "write_project_file":
            // A test can make chosen chapter writes fail (disk full) with `__failWrite = (path) => boolean`.
            if (a.path !== "cadabra.json" && (window as any).__failWrite?.(a.path)) throw { kind: "io", message: "No space left on device" };
            disk[a.path] = a.contents; persist(); return { hash: h(a.contents), conflict_copy: null };
          // Raw bytes as the body, root and path in percent-encoded headers (like the Rust command).
          case "write_project_bytes": if ((window as any).__failBytes) throw { kind: "io", message: "No space left on device" }; disk[decodeURIComponent(opts.headers.path)] = Array.from(a as Uint8Array); persist(); return null;
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
            {
              // The body is one binary frame: u32 LE header length, header JSON (typstPath, source, pdfA, files), file bytes.
              const n = new DataView(a.buffer, a.byteOffset).getUint32(0, true);
              ((window as any).__typstCalls ??= []).push(JSON.parse(new TextDecoder().decode(a.subarray(4, 4 + n))));
            }
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
          // Snapshots live at .cadabra/backups/<YYYYMMDD-HHMM>-<path with / as __>, like the Rust layer; tests seed them in `disk`.
          case "list_page_snapshots":
            return Object.keys(disk).filter((k) => k.startsWith(".cadabra/backups/") && k.endsWith(`-${a.path.replaceAll("/", "__")}`)).sort().reverse().map((k) => ({ path: k, at: k.slice(17, 30) }));
          case "read_page_snapshot": return { contents: disk[a.snapshot], hash: h(disk[a.snapshot] as string) };
          case "restore_page_snapshot": {
            disk[`.cadabra/backups/20261027-2359-${a.path.replaceAll("/", "__")}`] = disk[a.path]!; // the replaced text is kept first
            disk[a.path] = disk[a.snapshot]!; persist();
            return { hash: h(disk[a.path] as string), conflict_copy: null };
          }
          case "prune_page_snapshots": return 0;
          case "find_stale_pages": return JSON.parse(sessionStorage.getItem("stale") ?? "[]");
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
  expect(manifest).toMatchObject({ formatVersion: 3, title: "E2E Book", author: "Tester" });
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

  test("tables: Insert > Table and the Format > Table commands edit rows, columns and the header, and export", async ({ page }) => {
    // The native menu cannot be clicked in a browser; the dev build exposes its command runner (what each menu item calls).
    const menu = async (id: string) => {
      await page.waitForFunction(() => Boolean((window as any).__cadabraMenu));
      return page.evaluate((i) => (window as any).__cadabraMenu.run(i) as boolean, id);
    };
    const cells = (sel: string) => ed(page).locator(`table ${sel}`);
    expect(await menu("editor.tableAddRow")).toBe(false); // not in a table yet
    expect(await menu("editor.table")).toBe(true);
    const dialog = page.getByRole("dialog", { name: "Insert table" });
    await dialog.getByLabel("Rows").fill("3");
    await dialog.getByLabel("Columns").fill("2");
    await dialog.getByRole("button", { name: "Insert" }).click();
    await expect(cells("tr")).toHaveCount(3);
    await expect(cells("th")).toHaveCount(2);
    await expect(cells("td")).toHaveCount(4);

    await cells("th").first().click();
    await page.keyboard.type("Item");
    await page.keyboard.press("Tab");
    await page.keyboard.type("Cost & note");
    await page.keyboard.press("Tab");
    await page.keyboard.type("Ten");
    expect(await menu("editor.table")).toBe(false); // cells cannot hold tables

    expect(await menu("editor.tableAddRow")).toBe(true);
    await expect(cells("tr")).toHaveCount(4);
    expect(await menu("editor.tableAddColumn")).toBe(true);
    await expect(cells("tr").first().locator("th")).toHaveCount(3);
    expect(await menu("editor.tableDeleteColumn")).toBe(true);
    expect(await menu("editor.tableDeleteRow")).toBe(true);
    await expect(cells("tr")).toHaveCount(3);
    await expect(cells("tr").first().locator("th")).toHaveCount(2);

    await exportBook(page, "EPUB 3");
    await expect(page.getByRole("status")).toHaveText("Exported exports/book.epub");
    const saved = await page.evaluate(() => (window as any).__disk["manuscript/001-chapter-one.json"]);
    expect(saved).toContain('"type": "tableHeader"');
    expect(saved).toContain("Cost & note");

    await cells("td").first().click();
    expect(await menu("editor.tableHeaderRow")).toBe(true);
    await expect(cells("th")).toHaveCount(0);
    expect(await menu("editor.tableDelete")).toBe(true);
    await expect(ed(page).locator("table")).toHaveCount(0);
    expect(await menu("editor.tableDelete")).toBe(false);
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

test("Export Markdown writes exports/book.md, and explains underline until the HTML option is on", async ({ page }) => {
  await newProject(page);
  await page.locator(".ProseMirror").click();
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.press("ControlOrMeta+u");
  await page.keyboard.type("Underlined");
  await page.getByRole("button", { name: "Export", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Export book" });
  await dialog.getByRole("radio", { name: "Markdown" }).click();
  await expect(dialog.getByRole("button", { name: "Print preview" })).toHaveCount(0);
  await dialog.getByRole("button", { name: "Export", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText("underline");
  await dialog.getByLabel("Keep underline and small caps").check();
  await dialog.getByRole("button", { name: "Export", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole("status")).toHaveText("Exported exports/book.md");
  const md = await page.evaluate(() => String.fromCharCode(...((window as any).__disk["exports/book.md"] as number[])));
  expect(md).toContain("<u>Underlined</u>");
});

test("Export PDF dialog shows KDP print checks for a very short book", async ({ page }) => {
  await newProject(page);
  await page.locator(".ProseMirror").click();
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.type("Just a few words");
  await page.getByRole("button", { name: "Export", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Export book" });
  await dialog.getByRole("radio", { name: "Print PDF" }).click();
  const checks = dialog.getByRole("list", { name: "Print checks" });
  await expect(checks).toContainText("KDP paperbacks need at least 24");
  await expect(checks).toContainText("no cover image");
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
  await expect(page.getByRole("menuitem").first()).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(page.getByRole("menuitem").nth(1)).toBeFocused(); // Enter before focus moves would pick the first item
  await page.keyboard.press("Enter");
  // The menu opens on Title page, so one ArrowDown lands on Copyright.
  await expect(sidebar(page).getByRole("button", { name: "Copyright", exact: true })).toBeVisible();
  expect((await manifestOf(page)).frontMatter.map((e: any) => e.kind)).toEqual(["copyright"]);
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
  await page.getByRole("button", { name: "Details", exact: true }).click();
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

test("Book details: edit the title, pick a cover, save, then remove the cover", async ({ page }) => {
  await newProject(page);
  const manifest = () => page.evaluate(() => JSON.parse((window as any).__disk["cadabra.json"]));
  await page.getByRole("button", { name: "Book details" }).click();
  const dialog = page.getByRole("dialog", { name: "Book details" });
  await dialog.getByLabel("Title").fill("Renamed Book");
  await dialog.getByLabel("ISBN").fill("978-3-16-148410-0");
  await dialog.getByRole("button", { name: "Choose image…" }).click();
  await expect(dialog.getByRole("img", { name: "Cover preview" })).toBeVisible();
  await dialog.getByRole("button", { name: "Save details" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole("heading", { level: 1, name: "Renamed Book" })).toBeVisible();
  expect(await manifest()).toMatchObject({ title: "Renamed Book", isbn: "978-3-16-148410-0", cover: "assets/pic.png" });

  await page.getByRole("button", { name: "Book details" }).click();
  await dialog.getByLabel("Title").fill("");
  await dialog.getByRole("button", { name: "Save details" }).click();
  await expect(dialog.getByRole("alert")).toHaveText("Give the book a title.");
  await dialog.getByLabel("Title").fill("Renamed Book");
  await dialog.getByRole("button", { name: "Remove cover" }).click();
  await dialog.getByRole("button", { name: "Save details" }).click();
  await expect(dialog).toBeHidden();
  expect((await manifest()).cover).toBeNull();
});

test("print preview shows the cover, and the PDF dialog offers to include it only when there is one", async ({ page }) => {
  await newProject(page);
  await page.getByRole("button", { name: "Export", exact: true }).click();
  const exportDialog = page.getByRole("dialog", { name: "Export book" });
  await exportDialog.getByRole("radio", { name: "Print PDF" }).click();
  await expect(exportDialog.getByLabel("Include the cover")).toHaveCount(0);
  await page.keyboard.press("Escape");

  await page.getByRole("button", { name: "Book details" }).click();
  const details = page.getByRole("dialog", { name: "Book details" });
  await details.getByRole("button", { name: "Choose image…" }).click();
  await expect(details.getByRole("img", { name: "Cover preview" })).toBeVisible();
  await details.getByRole("button", { name: "Save details" }).click();
  await expect(details).toBeHidden();

  await page.getByRole("button", { name: "Export", exact: true }).click();
  await exportDialog.getByRole("radio", { name: "Print PDF" }).click();
  await expect(exportDialog.getByLabel("Include the cover")).toBeChecked();
  await exportDialog.getByRole("button", { name: "Print preview" }).click();
  await expect(page.getByRole("heading", { name: "Print preview" })).toBeVisible();
  await expect(page.getByRole("img", { name: "Cover", exact: true })).toBeVisible();
  await expect(page.getByText("Added as the first page, with a blank page behind it")).toBeVisible();
});

test.describe("sponsor dialog after an export", () => {
  test.beforeEach(async ({ page }) => {
    // Registered after the fake backend's script, so it runs after it and turns the dialog back on.
    await page.addInitScript(() => {
      if (sessionStorage.getItem("sponsorTest")) return; // only on the first load, so a reload keeps what the author chose
      sessionStorage.setItem("sponsorTest", "1");
      localStorage.removeItem("cadabracraft.sponsor");
    });
  });
  const exportEpub = async (page: Page) => {
    await page.getByRole("button", { name: "Export", exact: true }).click();
    await page.getByRole("dialog", { name: "Export book" }).getByRole("button", { name: "Export", exact: true }).click();
  };
  const sponsor = (page: Page) => page.getByRole("dialog", { name: "Enjoying CadabraCraft?" });

  test("appears after a successful export with the file name and three choices", async ({ page }) => {
    await newProject(page);
    await exportEpub(page);
    await expect(sponsor(page)).toBeVisible();
    await expect(sponsor(page).getByText("Exported exports/book.epub")).toBeVisible();
    for (const name of ["Don't show again", "Maybe later", "Sponsor"]) await expect(sponsor(page).getByRole("button", { name })).toBeVisible();
  });

  test("Maybe later hides it for the rest of the session only", async ({ page }) => {
    await newProject(page);
    await exportEpub(page);
    await sponsor(page).getByRole("button", { name: "Maybe later" }).click();
    await expect(sponsor(page)).toHaveCount(0);
    await exportEpub(page);
    await expect(page.getByRole("status")).toHaveText("Exported exports/book.epub");
    await expect(sponsor(page)).toHaveCount(0);
    expect(await page.evaluate(() => localStorage.getItem("cadabracraft.sponsor"))).toBeNull();
  });

  test("closing it with Escape asks again after the next export", async ({ page }) => {
    await newProject(page);
    await exportEpub(page);
    await page.keyboard.press("Escape");
    await expect(sponsor(page)).toHaveCount(0);
    await exportEpub(page);
    await expect(sponsor(page)).toBeVisible();
  });

  test("Don't show again is remembered across restarts", async ({ page }) => {
    await newProject(page);
    await exportEpub(page);
    await sponsor(page).getByRole("button", { name: "Don't show again" }).click();
    await expect(sponsor(page)).toHaveCount(0);
    expect(await page.evaluate(() => localStorage.getItem("cadabracraft.sponsor"))).toBe("hidden");
    await page.reload();
    await page.getByRole("button", { name: "Open folder" }).click();
    await expect(page.locator(".ProseMirror")).toBeVisible();
    await exportEpub(page);
    await expect(page.getByRole("status")).toHaveText("Exported exports/book.epub");
    await expect(sponsor(page)).toHaveCount(0);
  });

  test("Sponsor opens only the sponsor page in the browser and closes the dialog", async ({ page }) => {
    await newProject(page);
    await exportEpub(page);
    await sponsor(page).getByRole("button", { name: "Sponsor", exact: true }).click();
    await expect(sponsor(page)).toHaveCount(0);
    expect(await page.evaluate(() => (window as any).__opened)).toEqual(["https://github.com/sponsors/RabinApps"]);
  });

  test("does not appear when the export fails", async ({ page }) => {
    await newProject(page);
    await page.getByRole("button", { name: "Export", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Export book" });
    await dialog.getByRole("radio", { name: "Print PDF" }).click();
    await page.evaluate(() => { (window as any).__compileError = { kind: "compile", message: "main.typ:1:1: error: boom" }; });
    await dialog.getByRole("button", { name: "Export", exact: true }).click();
    await expect(dialog.getByRole("alert")).toBeVisible();
    await expect(sponsor(page)).toHaveCount(0);
  });
});

test.describe("find and replace", () => {
  const bar = (page: Page) => page.getByRole("search", { name: "Find and replace" });
  async function withText(page: Page) {
    await newProject(page);
    await page.locator(".ProseMirror").click();
    await page.keyboard.press("ControlOrMeta+End");
    await page.keyboard.type(" The cat sat. The cat ran. A cat slept.");
  }

  test("finds, steps, replaces one, replaces all in one undo step, and Escape clears it", async ({ page }) => {
    await withText(page);
    await page.keyboard.press("ControlOrMeta+f");
    await expect(bar(page)).toBeVisible();
    await expect(bar(page).getByLabel("Find", { exact: true })).toBeFocused();
    await page.keyboard.type("cat");
    await expect(bar(page).getByText("1 of 3")).toBeVisible();
    await expect(page.locator(".search-match")).toHaveCount(3);
    const current = () => page.locator(".search-match-current").evaluate((el) => Array.from(document.querySelectorAll(".search-match")).indexOf(el));
    const first = await current();
    await page.keyboard.press("Enter");
    await expect(bar(page).getByText("2 of 3")).toBeVisible();
    expect(await current()).not.toBe(first);
    await page.keyboard.press("Shift+Enter");
    await expect(bar(page).getByText("1 of 3")).toBeVisible();

    await bar(page).getByLabel("Replace with").fill("dog");
    await bar(page).getByRole("button", { name: "Replace", exact: true }).click();
    await expect(page.locator(".ProseMirror")).toContainText("The dog sat.");
    await expect(bar(page).getByText("1 of 2")).toBeVisible();
    await bar(page).getByRole("button", { name: "Replace all" }).click();
    await expect(page.locator(".ProseMirror")).not.toContainText("cat");
    await expect(bar(page).getByText("No results")).toBeVisible();
    await expect(bar(page).getByRole("button", { name: "Replace all" })).toBeDisabled();

    await page.locator(".ProseMirror").click();
    await page.keyboard.press("ControlOrMeta+z");
    await expect(page.locator(".ProseMirror")).toContainText("The dog sat. The cat ran. A cat slept."); // one step undid Replace all only

    await page.keyboard.press("ControlOrMeta+f");
    await page.keyboard.press("Escape");
    await expect(bar(page)).toHaveCount(0);
    await expect(page.locator(".search-match")).toHaveCount(0);
    await expect(page.locator(".ProseMirror")).toBeFocused();
  });

  test("toggles match case and whole word, and Cmd+Alt+F hides the replace row", async ({ page }) => {
    await withText(page);
    await page.keyboard.press("ControlOrMeta+f");
    await page.keyboard.type("the");
    await expect(page.locator(".search-match")).toHaveCount(2);
    await bar(page).getByRole("button", { name: "Match case" }).click();
    await expect(bar(page).getByRole("button", { name: "Match case" })).toHaveAttribute("aria-pressed", "true");
    await expect(bar(page).getByText("No results")).toBeVisible();
    await bar(page).getByRole("button", { name: "Match case" }).click();
    await bar(page).getByRole("button", { name: "Whole word" }).click();
    await expect(page.locator(".search-match")).toHaveCount(2);
    await expect(bar(page).getByLabel("Replace with")).toBeVisible();
    await page.keyboard.press("ControlOrMeta+Alt+f");
    await expect(bar(page).getByLabel("Replace with")).toHaveCount(0);
  });

  test("All chapters: counts the whole book, steps into other chapters, and replaces everywhere with one book undo", async ({ page }) => {
    await newProject(page);
    const typeInPage = async (text: string) => {
      await page.locator(".ProseMirror").click();
      await page.keyboard.press("ControlOrMeta+End");
      await page.keyboard.type(text);
    };
    await typeInPage(" owl one owl");
    await page.getByRole("button", { name: "Add chapter", exact: true }).click();
    await expect(page.locator(".ProseMirror h1")).toHaveText("Chapter 2");
    await typeInPage("owl two");
    await page.getByRole("button", { name: "Add chapter", exact: true }).click();
    await expect(page.locator(".ProseMirror h1")).toHaveText("Chapter 3");
    await typeInPage("nothing here");
    await addPage(page, "Dedication");
    await typeInPage(" owl dedication");
    await page.getByRole("button", { name: "Chapter One", exact: true }).click();
    await expect(page.locator(".ProseMirror")).toContainText("owl one owl");

    await page.keyboard.press("ControlOrMeta+f");
    await page.keyboard.type("owl");
    await expect(bar(page).getByText("1 of 2")).toBeVisible(); // this chapter only
    const all = bar(page).getByRole("button", { name: "All chapters" });
    await expect(all).toHaveAttribute("aria-pressed", "false");
    await all.click();
    // Reading order: Dedication (1), Chapter One (2), Chapter 2 (1), Chapter 3 (0).
    await expect(bar(page).getByText("2 of 4")).toBeVisible();
    await bar(page).getByLabel("Find", { exact: true }).press("Enter");
    await expect(bar(page).getByText("3 of 4")).toBeVisible();
    await bar(page).getByLabel("Find", { exact: true }).press("Enter");
    await expect(page.locator(".ProseMirror")).toContainText("owl two"); // opened Chapter 2
    await expect(bar(page).getByText("4 of 4")).toBeVisible();
    await expect(page.locator(".search-match-current")).toHaveText("owl");
    await bar(page).getByLabel("Find", { exact: true }).press("Enter"); // wraps to the first page
    await expect(page.locator(".ProseMirror")).toContainText("owl dedication");
    await expect(bar(page).getByText("1 of 4")).toBeVisible();
    await bar(page).getByLabel("Find", { exact: true }).press("Shift+Enter"); // back to the last match
    await expect(page.locator(".ProseMirror")).toContainText("owl two");
    await expect(bar(page).getByText("4 of 4")).toBeVisible();

    await bar(page).getByLabel("Replace with").fill("dog");
    await bar(page).getByRole("button", { name: "Replace all" }).click();
    await expect(bar(page).getByText("No results")).toBeVisible();
    await expect(page.locator(".ProseMirror")).toContainText("dog two");
    const disk = () => page.evaluate(() => Object.entries((window as any).__disk).filter(([k]) => /\.json$/.test(k) && !k.includes(".cadabra") && k !== "cadabra.json").map(([, v]) => v as string).join("\n"));
    expect(await disk()).not.toContain("owl");
    expect((await disk()).match(/dog/g)).toHaveLength(4);
    await page.getByRole("button", { name: "Chapter One", exact: true }).click();
    await expect(page.locator(".ProseMirror")).toContainText("dog one dog");

    await page.keyboard.press("ControlOrMeta+Alt+z"); // one book undo restores every page
    await expect.poll(async () => ((await disk()).match(/owl/g) ?? []).length).toBe(4);
    await expect(page.locator(".ProseMirror")).toContainText("owl one owl");
    await page.getByRole("button", { name: "Chapter 2", exact: true }).click();
    await expect(page.locator(".ProseMirror")).toContainText("owl two");
  });

  test("Regex: invalid pattern, captures, $& and $$, and literal replacement when off", async ({ page }) => {
    await withText(page);
    await page.keyboard.press("ControlOrMeta+f");
    const find = bar(page).getByLabel("Find", { exact: true });
    const regex = bar(page).getByRole("button", { name: "Regex" });
    await expect(regex).toHaveAttribute("aria-pressed", "false");
    await find.fill("c.t");
    await expect(bar(page).getByText("No results")).toBeVisible();
    await regex.click();
    await expect(regex).toHaveAttribute("aria-pressed", "true");
    await expect(bar(page).getByText("1 of 3")).toBeVisible();

    const errors: string[] = [];
    page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
    page.on("pageerror", (e) => errors.push(String(e)));
    await find.fill("(");
    await expect(bar(page).getByText("Invalid pattern")).toBeVisible();
    await expect(bar(page).getByRole("button", { name: "Replace all" })).toBeDisabled();
    await expect(bar(page).getByRole("button", { name: "Replace", exact: true })).toBeDisabled();
    await find.fill("c(?=a)");
    await expect(bar(page).getByText("Invalid pattern")).toBeVisible();
    await find.fill("(a)\\1");
    await expect(bar(page).getByText("Invalid pattern")).toBeVisible();
    await expect(page.locator(".search-match")).toHaveCount(0);
    expect(errors).toEqual([]);

    await find.fill("The (c\\w+) (\\w+)\\.");
    await expect(bar(page).getByText("1 of 2")).toBeVisible();
    await bar(page).getByLabel("Replace with").fill("$2 $1 [$&] $$5");
    await bar(page).getByRole("button", { name: "Replace all" }).click();
    await expect(page.locator(".ProseMirror")).toContainText("sat cat [The cat sat.] $5 ran cat [The cat ran.] $5 A cat slept.");
    await page.locator(".ProseMirror").click();
    await page.keyboard.press("ControlOrMeta+z");
    await expect(page.locator(".ProseMirror")).toContainText("The cat sat. The cat ran. A cat slept.");

    await regex.click();
    await find.fill("cat");
    await bar(page).getByLabel("Replace with").fill("$&");
    await bar(page).getByRole("button", { name: "Replace all" }).click();
    await expect(page.locator(".ProseMirror")).toContainText("The $& sat. The $& ran. A $& slept.");
  });

  test("Regex in All chapters: replaces book-wide with captures, one book undo", async ({ page }) => {
    await newProject(page);
    const typeInPage = async (text: string) => {
      await page.locator(".ProseMirror").click();
      await page.keyboard.press("ControlOrMeta+End");
      await page.keyboard.type(text);
    };
    await typeInPage(" id-1 id-2");
    await page.getByRole("button", { name: "Add chapter", exact: true }).click();
    await expect(page.locator(".ProseMirror h1")).toHaveText("Chapter 2");
    await typeInPage("id-3");
    await page.getByRole("button", { name: "Chapter One", exact: true }).click();
    await expect(page.locator(".ProseMirror")).toContainText("id-1 id-2");

    await page.keyboard.press("ControlOrMeta+f");
    await bar(page).getByRole("button", { name: "Regex" }).click();
    await bar(page).getByRole("button", { name: "All chapters" }).click();
    await bar(page).getByLabel("Find", { exact: true }).fill("id-(\\d)");
    await expect(bar(page).getByText("1 of 3")).toBeVisible();
    await bar(page).getByLabel("Replace with").fill("item$1");
    await bar(page).getByRole("button", { name: "Replace all" }).click();
    await expect(bar(page).getByText("No results")).toBeVisible();
    const disk = () => page.evaluate(() => Object.entries((window as any).__disk).filter(([k]) => /\.json$/.test(k) && !k.includes(".cadabra") && k !== "cadabra.json").map(([, v]) => v as string).join("\n"));
    expect(await disk()).toContain("item1 item2");
    expect(await disk()).toContain("item3");
    expect(await disk()).not.toContain("id-");
    await page.keyboard.press("ControlOrMeta+Alt+z");
    await expect.poll(async () => ((await disk()).match(/id-\d/g) ?? []).length).toBe(3);
  });

  /** Chapter One (2 owls), Chapter 2 (1), Chapter 3 (0) and a Dedication (1); Chapter One is left open. */
  async function owlBook(page: Page) {
    await newProject(page);
    const typeInPage = async (text: string) => {
      await page.locator(".ProseMirror").click();
      await page.keyboard.press("ControlOrMeta+End");
      await page.keyboard.type(text);
    };
    await typeInPage(" owl one owl");
    await page.getByRole("button", { name: "Add chapter", exact: true }).click();
    await expect(page.locator(".ProseMirror h1")).toHaveText("Chapter 2");
    await typeInPage("owl two");
    await page.getByRole("button", { name: "Add chapter", exact: true }).click();
    await expect(page.locator(".ProseMirror h1")).toHaveText("Chapter 3");
    await typeInPage("nothing here");
    await addPage(page, "Dedication");
    await typeInPage(" owl dedication");
    await page.getByRole("button", { name: "Chapter One", exact: true }).click();
    await expect(page.locator(".ProseMirror")).toContainText("owl one owl");
  }

  test("All chapters: results list shows pages with counts, opens a page on click, and is absent when off", async ({ page }) => {
    await owlBook(page);
    await page.keyboard.press("ControlOrMeta+f");
    await page.keyboard.type("owl");
    const list = bar(page).getByRole("list", { name: "Results by page" });
    await expect(list).toHaveCount(0); // chip is off
    await bar(page).getByRole("button", { name: "All chapters" }).click();
    const rows = list.getByRole("button");
    await expect(rows).toHaveCount(3);
    await expect(list.getByRole("button", { name: "Front matter: Dedication, 1 match", exact: true })).toBeVisible();
    await expect(list.getByRole("button", { name: "Chapter One, 2 matches", exact: true })).toHaveAttribute("aria-current", "true");
    await expect(list.getByRole("button", { name: "Chapter 2, 1 match", exact: true })).toBeVisible();
    await expect(list.getByRole("button", { name: "Chapter 3" })).toHaveCount(0);

    await list.getByRole("button", { name: "Chapter 2, 1 match" }).click();
    await expect(page.locator(".ProseMirror")).toContainText("owl two");
    await expect(page.locator(".search-match-current")).toHaveText("owl");
    await expect(bar(page).getByText("4 of 4")).toBeVisible();
    await expect(list.getByRole("button", { name: "Chapter 2, 1 match" })).toHaveAttribute("aria-current", "true");

    await bar(page).getByLabel("Find", { exact: true }).fill("zzz");
    await expect(list).toHaveCount(0); // no matches
    await bar(page).getByLabel("Find", { exact: true }).fill("owl");
    await expect(rows).toHaveCount(3);
    await bar(page).getByRole("button", { name: "All chapters" }).click();
    await expect(list).toHaveCount(0);
  });

  test("All chapters: results list works with Regex and refreshes after Replace all", async ({ page }) => {
    await owlBook(page);
    await page.keyboard.press("ControlOrMeta+f");
    await bar(page).getByRole("button", { name: "All chapters" }).click();
    await bar(page).getByRole("button", { name: "Regex" }).click();
    const find = bar(page).getByLabel("Find", { exact: true });
    const list = bar(page).getByRole("list", { name: "Results by page" });
    await find.fill("(");
    await expect(bar(page).getByText("Invalid pattern")).toBeVisible();
    await expect(list).toHaveCount(0);
    await find.fill("o.l");
    await expect(list.getByRole("button")).toHaveCount(3);
    await find.fill("owl two");
    await expect(list.getByRole("button")).toHaveCount(1);
    await find.fill("o.l");
    await bar(page).getByLabel("Replace with").fill("dog");
    await bar(page).getByRole("button", { name: "Replace all" }).click();
    await expect(bar(page).getByText("No results")).toBeVisible();
    await expect(list).toHaveCount(0);
    await page.keyboard.press("ControlOrMeta+Alt+z");
    await expect(list.getByRole("button")).toHaveCount(3);
  });

  test("All chapters: results list scrolls past its row limit and fits a phone", async ({ page }) => {
    await newProject(page);
    for (let i = 0; i < 4; i++) {
      await page.locator(".ProseMirror").click();
      await page.keyboard.press("ControlOrMeta+End");
      await page.keyboard.type(" owl with a rather long sentence so that nothing could possibly fit");
      await page.getByRole("button", { name: "Add chapter", exact: true }).click();
      await expect(page.locator(".ProseMirror h1")).toHaveText(`Chapter ${i + 2}`);
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator(".ProseMirror").click();
    await page.keyboard.press("ControlOrMeta+f");
    await page.keyboard.type("owl");
    await bar(page).getByRole("button", { name: "All chapters" }).click();
    const list = bar(page).getByRole("list", { name: "Results by page" });
    await expect(list.getByRole("button")).toHaveCount(4);
    const first = await list.getByRole("button").first().boundingBox();
    expect(first!.height).toBeGreaterThanOrEqual(44);
    const box = await list.boundingBox();
    expect(box!.height).toBeLessThanOrEqual(133);
    expect(await list.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true);
    const bb = await bar(page).boundingBox();
    expect(bb!.x + bb!.width).toBeLessThanOrEqual(390);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });

  test("is not available while reading", async ({ page }) => {
    await withText(page);
    await page.getByRole("radio", { name: "Read" }).click();
    await page.keyboard.press("ControlOrMeta+f");
    await expect(bar(page)).toHaveCount(0);
  });

  test("fits a phone without horizontal overflow", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await withText(page);
    await page.keyboard.press("ControlOrMeta+f");
    await page.keyboard.type("cat");
    await expect(bar(page)).toBeVisible();
    const box = await bar(page).boundingBox();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(390);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await expect(bar(page).getByRole("button", { name: "Close" })).toBeVisible();
  });
});

test.describe("pasting HTML text", () => {
  const HTML = "<p>The gate was <b>old</b></p>";
  const dlg = (page: Page) => page.getByRole("dialog", { name: "Paste as styled text?" });
  /** A paste event the way a code editor sends it: text/plain only, unless `html` is given too. */
  async function paste(page: Page, text: string, html?: string) {
    await page.evaluate(([t, h]) => {
      const dt = new DataTransfer();
      dt.setData("text/plain", t!);
      if (h) dt.setData("text/html", h);
      document.querySelector(".ProseMirror")!.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
    }, [text, html ?? ""]);
  }
  /** Caret in the empty paragraph under the chapter title. */
  const toEnd = async (page: Page) => {
    await page.locator(".ProseMirror p").last().click();
    // A real key makes ProseMirror read the click's selection before the synthetic paste.
    await page.keyboard.type("Q");
    await page.keyboard.press("Backspace");
  };
  async function ready(page: Page) {
    await newProject(page);
    await toEnd(page);
  }
  const convertCommand = (page: Page) => page.evaluate(async () => { (await import("/src/app/commands.ts" as string)).runCommand("edit.convertHtml"); });

  test("asks, converts to styled text, and one Undo restores", async ({ page }) => {
    await ready(page);
    await paste(page, HTML);
    await expect(dlg(page)).toBeVisible();
    await expect(dlg(page).getByTestId("paste-source")).toHaveText(HTML);
    await expect(dlg(page).getByTestId("paste-result")).toHaveText("The gate was old");
    await dlg(page).getByRole("button", { name: "Convert" }).click();
    await expect(dlg(page)).toHaveCount(0);
    await expect(page.locator(".ProseMirror p").last()).toHaveText("The gate was old");
    await expect(page.locator(".ProseMirror p strong").last()).toHaveText("old");
    await expect(page.locator(".ProseMirror")).toBeFocused();
    await page.keyboard.press("ControlOrMeta+z");
    await expect(page.locator(".ProseMirror")).not.toContainText("The gate was");
    await expect(page.locator(".ProseMirror strong")).toHaveCount(0);
  });

  test("Keep as text inserts the tags literally", async ({ page }) => {
    await ready(page);
    await paste(page, HTML);
    await dlg(page).getByRole("button", { name: "Keep as text" }).click();
    await expect(page.locator(".ProseMirror p").last()).toHaveText(HTML);
    await expect(page.locator(".ProseMirror strong")).toHaveCount(0);
    await expect(page.locator(".ProseMirror")).toBeFocused();
  });

  test("Escape closes without inserting and returns focus to the editor", async ({ page }) => {
    await ready(page);
    await paste(page, HTML);
    await page.keyboard.press("Escape");
    await expect(dlg(page)).toHaveCount(0);
    await expect(page.locator(".ProseMirror")).not.toContainText("The gate");
    await expect(page.locator(".ProseMirror")).toBeFocused();
  });

  test("Remember my choice converts the next paste without asking and shows in Settings", async ({ page }) => {
    await ready(page);
    await paste(page, HTML);
    await dlg(page).getByLabel("Remember my choice").check();
    await dlg(page).getByRole("button", { name: "Convert" }).click();
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem("cadabracraft.settings") ?? "{}").rawHtmlPaste)).toBe("convert");
    await page.keyboard.press("Enter");
    await paste(page, "<p>Second <i>one</i></p>");
    await expect(dlg(page)).toHaveCount(0);
    await expect(page.locator(".ProseMirror em")).toHaveText("one");
    await page.getByRole("button", { name: "Settings" }).click();
    await expect(page.getByRole("combobox", { name: "When pasting HTML" })).toHaveValue("convert");
  });

  test("Settings can keep HTML as text, which pastes the default way", async ({ page }) => {
    await ready(page);
    await page.getByRole("button", { name: "Settings" }).click();
    await page.getByRole("combobox", { name: "When pasting HTML" }).selectOption("text");
    await page.getByRole("button", { name: "Back", exact: true }).click();
    await toEnd(page);
    await paste(page, HTML);
    await expect(dlg(page)).toHaveCount(0);
  });

  test("a clipboard with real text/html keeps the normal paste", async ({ page }) => {
    await ready(page);
    await paste(page, HTML, "<p>The gate was <b>old</b></p>");
    await expect(dlg(page)).toHaveCount(0);
  });

  test("plain text with a stray < is not offered for conversion", async ({ page }) => {
    await ready(page);
    await paste(page, "if a < b and c > d");
    await expect(dlg(page)).toHaveCount(0);
  });

  test("inside a code block it pastes as-is", async ({ page }) => {
    await ready(page);
    await page.keyboard.type("``` ");
    await expect(page.locator(".ProseMirror pre")).toBeVisible();
    await paste(page, HTML);
    await expect(dlg(page)).toHaveCount(0);
  });

  test("Convert HTML in Selection replaces the selected tags, and says so when there are none", async ({ page }) => {
    await ready(page);
    // Select the last paragraph's text explicitly (Shift+Home depends on where the caret landed), then let ProseMirror read the selection
    const selectLastParagraph = async (text: string) => {
      await page.evaluate(() => {
        const p = [...document.querySelectorAll(".ProseMirror p")].pop()!;
        const r = document.createRange();
        r.selectNodeContents(p);
        const sel = getSelection()!;
        sel.removeAllRanges();
        sel.addRange(r);
      });
      await expect.poll(() => page.evaluate(() => getSelection()?.toString())).toBe(text);
      await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    };
    await page.keyboard.type("<u>mark</u>");
    await selectLastParagraph("<u>mark</u>");
    // under load ProseMirror can still hold the previous selection when the command runs; select again and retry until it converts
    await expect(async () => {
      await selectLastParagraph("<u>mark</u>");
      await convertCommand(page);
      await expect(page.locator(".ProseMirror u")).toHaveText("mark", { timeout: 1000 });
    }).toPass({ timeout: 10000 });
    await selectLastParagraph("mark");
    await convertCommand(page);
    await expect(page.getByRole("status").filter({ hasText: "No HTML found in the selection" })).toBeVisible();
  });

  test("the dialog fits a phone", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await ready(page);
    await paste(page, `<p>${"long word ".repeat(40)}<b>end</b></p>`);
    await expect(dlg(page)).toBeVisible();
    const box = await dlg(page).boundingBox();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(390);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await expect(dlg(page).getByRole("button", { name: "Convert" })).toBeVisible();
  });
});

test.describe("hardening: paste, find and export failures", () => {
  const ed = (page: Page) => page.locator(".ProseMirror");
  const dlg = (page: Page) => page.getByRole("dialog", { name: "Paste as styled text?" });
  const bar = (page: Page) => page.getByRole("search", { name: "Find and replace" });
  async function paste(page: Page, text: string) {
    await page.evaluate((t) => {
      const dt = new DataTransfer();
      dt.setData("text/plain", t);
      document.querySelector(".ProseMirror")!.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
    }, text);
  }
  async function ready(page: Page) {
    await newProject(page);
    await page.locator(".ProseMirror p").last().click();
    await page.keyboard.type("Q");
    await page.keyboard.press("Backspace");
  }
  const menu = async (page: Page, id: string) => {
    await page.waitForFunction(() => Boolean((window as any).__cadabraMenu));
    return page.evaluate((i) => (window as any).__cadabraMenu.run(i) as boolean, id);
  };

  test("pasting text the converter refuses (thousands of nested divs) pastes as text with a notice and the editor keeps working", async ({ page }) => {
    await ready(page);
    await paste(page, "<div>".repeat(3000));
    await expect(dlg(page)).toHaveCount(0);
    await expect(page.getByRole("status").filter({ hasText: "Could not convert the HTML" })).toBeVisible();
    await expect(ed(page)).toContainText("<div><div>");
    await page.keyboard.type("still typing");
    await expect(ed(page)).toContainText("still typing");
  });

  test("a multi-megabyte paste is left to the normal paste without opening the dialog", async ({ page }) => {
    await ready(page);
    await paste(page, `<p>x</p> ${"word ".repeat(250_000)}`);
    await expect(dlg(page)).toHaveCount(0);
  });

  test("a second paste while the dialog is open is ignored", async ({ page }) => {
    await ready(page);
    await paste(page, "<p>First <b>one</b></p>");
    await expect(dlg(page)).toBeVisible();
    await paste(page, "<p>Second <i>one</i></p>");
    await expect(dlg(page)).toHaveCount(1);
    await expect(dlg(page).getByTestId("paste-source")).toHaveText("<p>First <b>one</b></p>");
    await dlg(page).getByRole("button", { name: "Convert" }).click();
    await expect(ed(page)).toContainText("First one");
    await expect(ed(page)).not.toContainText("Second");
  });

  test("converted blocks pasted into a heading and a table cell stay valid", async ({ page }) => {
    await ready(page);
    await page.locator(".ProseMirror h1").click();
    await page.keyboard.press("End");
    // A real key makes ProseMirror read the click's selection before the synthetic paste.
    await page.keyboard.type("Q");
    await page.keyboard.press("Backspace");
    await expect(page.locator(".ProseMirror h1")).toHaveText("Chapter One");
    await paste(page, "<h2>Extra</h2><p>Body</p>");
    await dlg(page).getByRole("button", { name: "Convert" }).click();
    await expect(page.locator(".ProseMirror h1")).toHaveText("Chapter OneExtra Body");
    await page.locator(".ProseMirror p").last().click();
    expect(await menu(page, "editor.table")).toBe(true);
    await page.getByRole("dialog", { name: "Insert table" }).getByRole("button", { name: "Insert" }).click();
    await expect(ed(page).locator("td").first()).toBeVisible();
    await ed(page).locator("td").first().click();
    await page.keyboard.type("Q");
    await page.keyboard.press("Backspace");
    await paste(page, "<h2>Cell</h2><ul><li>one</li></ul>");
    await dlg(page).getByRole("button", { name: "Convert" }).click();
    await expect(ed(page).locator("td h2, td ul")).toHaveCount(0);
    await expect(ed(page).locator("td").first()).toContainText("Cell");
  });

  test("replacing across the book stops cleanly when a page cannot be written, and changes nothing", async ({ page }) => {
    await newProject(page);
    const typeInPage = async (text: string) => {
      await ed(page).click();
      await page.keyboard.press("ControlOrMeta+End");
      await page.keyboard.type(text);
    };
    await typeInPage(" owl one");
    await page.getByRole("button", { name: "Add chapter", exact: true }).click();
    await expect(ed(page).locator("h1")).toHaveText("Chapter 2");
    await typeInPage("owl two");
    await page.getByRole("button", { name: "Chapter One", exact: true }).click();
    await expect(ed(page)).toContainText("owl one");
    await page.keyboard.press("ControlOrMeta+f");
    await page.keyboard.type("owl");
    await bar(page).getByRole("button", { name: "All chapters" }).click();
    await bar(page).getByLabel("Replace with").fill("hen");
    await page.evaluate(() => { (window as any).__failWrite = (p: string) => p.includes("002-"); });
    await bar(page).getByRole("button", { name: "Replace all" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Replace all stopped" })).toContainText("No space left on device");
    await expect(page.getByRole("status")).toContainText("Nothing was changed");
    const disk = await page.evaluate(() => (window as any).__disk as Record<string, string>);
    expect(disk["manuscript/001-chapter-one.json"]).toContain("owl one");
    expect(disk["manuscript/001-chapter-one.json"]).not.toContain("hen");
    expect(disk["manuscript/002-chapter-2.json"]).toContain("owl two");
  });

  test("Enter while composing text (IME) does not step or replace", async ({ page }) => {
    await newProject(page);
    await ed(page).click();
    await page.keyboard.type(" owl owl");
    await page.keyboard.press("ControlOrMeta+f");
    await page.keyboard.type("owl");
    await expect(bar(page).getByText("1 of 2")).toBeVisible();
    await bar(page).getByLabel("Find", { exact: true }).dispatchEvent("keydown", { key: "Enter", isComposing: true, keyCode: 229, bubbles: true });
    await expect(bar(page).getByText("1 of 2")).toBeVisible();
    await bar(page).getByLabel("Find", { exact: true }).press("Enter");
    await expect(bar(page).getByText("2 of 2")).toBeVisible();
  });

  test("Export Markdown: a write failure shows the reason, keeps the dialog usable and shows no success", async ({ page }) => {
    await newProject(page);
    await page.evaluate(() => { (window as any).__failBytes = true; });
    await page.getByRole("button", { name: "Export", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Export book" });
    await dialog.getByRole("radio", { name: "Markdown" }).click();
    await dialog.getByRole("button", { name: "Export", exact: true }).click();
    await expect(dialog.getByRole("alert")).toContainText("No space left on device");
    await expect(dialog.getByRole("button", { name: "Export", exact: true })).toBeEnabled();
    await expect(page.getByRole("status").filter({ hasText: "Exported" })).toHaveCount(0);
    await page.evaluate(() => { (window as any).__failBytes = false; });
    await dialog.getByRole("button", { name: "Export", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByRole("status")).toHaveText("Exported exports/book.md");
  });

  test("Export Markdown: an unreadable chapter file is named in the error", async ({ page }) => {
    await newProject(page);
    await page.evaluate(() => { (window as any).__disk["manuscript/001-chapter-one.json"] = "{ not json"; });
    await page.getByRole("button", { name: "Export", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Export book" });
    await dialog.getByRole("radio", { name: "Markdown" }).click();
    await dialog.getByRole("button", { name: "Export", exact: true }).click();
    await expect(dialog.getByRole("alert")).toContainText("manuscript/001-chapter-one.json");
  });
});

/** Seeds an earlier version of the first chapter as a snapshot and returns its path. */
async function seedSnapshot(page: Page, words: string) {
  return page.evaluate((w) => {
    const disk = (window as any).__disk;
    const file = JSON.parse(disk["cadabra.json"]).chapters[0].file as string;
    const doc = { type: "doc", content: [{ type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "Chapter One" }] }, { type: "paragraph", content: [{ type: "text", text: w }] }] };
    const path = `.cadabra/backups/20261027-1000-${file.replaceAll("/", "__")}`;
    disk[path] = JSON.stringify(doc);
    sessionStorage.setItem("disk", JSON.stringify(disk));
    return { file, path };
  }, words);
}

test("History compares an earlier version with the current text and restores it", async ({ page }) => {
  await newProject(page);
  await page.locator(".ProseMirror").click();
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.type("Marta walked home");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("status")).toHaveText("Saved");
  const { file } = await seedSnapshot(page, "Ilse walked home");

  await chapterAction(page, "Chapter One", "History");
  const dialog = page.getByRole("dialog", { name: "History · Chapter One" });
  await expect(dialog.locator("ins", { hasText: "Ilse" })).toBeVisible();
  await expect(dialog.locator("del", { hasText: "Marta" })).toBeVisible();
  await expect(dialog.getByRole("list", { name: "Earlier versions" }).getByRole("button")).toHaveCount(1);

  await dialog.getByRole("button", { name: "Restore this version" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.locator(".ProseMirror")).toContainText("Ilse walked home");
  const kept = await page.evaluate((f) => (window as any).__disk[`.cadabra/backups/20261027-2359-${f.replaceAll("/", "__")}`], file);
  expect(kept).toContain("Marta walked home");
});

test("History says so when a page has no earlier versions", async ({ page }) => {
  await newProject(page);
  await chapterAction(page, "Chapter One", "History");
  await expect(page.getByRole("dialog", { name: "History · Chapter One" })).toContainText("No earlier versions yet");
});

test("a page with a newer snapshot than its saved text is offered for recovery when the book opens", async ({ page }) => {
  await newProject(page);
  await page.locator(".ProseMirror").click();
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.type("older text on disk");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("status")).toHaveText("Saved");
  const { file, path } = await seedSnapshot(page, "the newer text");
  await page.evaluate((x) => sessionStorage.setItem("stale", JSON.stringify([x])), { path: file, snapshot: path });
  await page.reload();
  await page.getByRole("button", { name: "Open folder" }).click();

  const dialog = page.getByRole("dialog", { name: "Recover newer text for “Chapter One”?" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Keep saved text" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.locator(".ProseMirror")).toContainText("older text on disk");

  await page.evaluate(() => sessionStorage.setItem("stale", sessionStorage.getItem("stale")!));
  await page.reload();
  await page.getByRole("button", { name: "Open folder" }).click();
  await page.getByRole("dialog", { name: "Recover newer text for “Chapter One”?" }).getByRole("button", { name: "Use newer text" }).click();
  await expect(page.locator(".ProseMirror")).toContainText("the newer text");
});
