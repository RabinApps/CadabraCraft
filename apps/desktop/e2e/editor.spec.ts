import { expect, test, type Page } from "@playwright/test";

// The Tauri backend is replaced with an in-memory fake of the same commands (persisted in sessionStorage so
// reloads work), so the real UI, TipTap editor, store and EPUB exporter run in a plain browser.
// Backend behaviour is covered by the Rust tests in src-tauri/src/project.
async function fakeTauri(page: Page) {
  await page.addInitScript(() => {
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
          case "plugin:dialog|open": return "/proj";
          case "plugin:event|listen": return 1;
          case "plugin:event|unlisten": return null;
          case "watch_project": return null;
          case "create_project": disk["cadabra.json"] = a.manifestJson; persist(); return null;
          case "read_project_file": return typeof disk[a.path] === "string" ? { contents: disk[a.path], hash: h(disk[a.path] as string) } : null;
          case "write_project_file": disk[a.path] = a.contents; persist(); return { hash: h(a.contents), conflict_copy: null };
          case "write_project_bytes": disk[a.path] = a.bytes; persist(); return null;
          case "backup_manifest": return "backup";
          case "trash_project_file": disk[`.cadabra/trash/${a.path}`] = disk[a.path]!; delete disk[a.path]; persist(); return "t";
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
const titles = (page: Page) => page.getByRole("navigation", { name: "Chapters" }).locator("li > button[aria-current]").allTextContents();

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
  expect(manifest).toMatchObject({ formatVersion: 1, title: "E2E Book", author: "Tester" });
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
  await page.getByRole("button", { name: "Export EPUB" }).click();
  await expect(page.getByRole("status")).toHaveText("Exported exports/book.epub");
  const head = await page.evaluate(() => {
    const b = (window as any).__disk["exports/book.epub"] as number[];
    return String.fromCharCode(...b.slice(0, 4), ...b.slice(30, 38));
  });
  expect(head).toBe("PK\u0003\u0004mimetype");
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
    await page.getByRole("button", { name: "Export EPUB" }).click();
    await expect(page.getByRole("status")).toHaveText("Exported exports/book.epub");
    const saved = await page.evaluate(() => (window as any).__disk["manuscript/001-chapter-one.json"]);
    expect(saved).toContain("sceneBreak");
    expect(saved).toContain("footnote");
  });

  test("links accept https and refuse javascript:", async ({ page }) => {
    const answers = ["javascript:alert(1)", "example.com"];
    page.removeAllListeners("dialog");
    page.on("dialog", (d) => (d.type() === "prompt" ? d.accept(answers.shift()!) : d.accept()));
    await typeLine(page, "click me");
    await selectLine(page);
    await tb(page, "Link").click(); // refused: alert dialog
    await expect(ed(page).locator("a")).toHaveCount(0);
    await tb(page, "Link").click();
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
  await page.getByRole("radio", { name: "Dark theme" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
});

test("phone layout reaches chapters through the sheet", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await newProject(page);
  await expect(page.getByRole("navigation", { name: "Chapters" })).toHaveCount(0);
  await page.getByRole("button", { name: "Show chapters" }).click();
  await page.getByRole("button", { name: "Add chapter" }).click();
  await expect(page.locator(".ProseMirror h1")).toHaveText("Chapter 2");
  await page.getByRole("button", { name: "Chapter One", exact: true }).click();
  await expect(page.getByRole("navigation", { name: "Chapters" })).toHaveCount(0);
  await expect(page.locator(".ProseMirror h1")).toHaveText("Chapter One");
});

test("language picker switches the UI to the pseudo-locale and remembers it", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page.locator("html")).toHaveAttribute("dir", "ltr");
  await page.getByLabel("Language").selectOption("pseudo");
  await expect(page.getByRole("button", { name: "New project" })).toHaveCount(0);
  await expect(page.getByRole("heading", { level: 1 })).not.toHaveText("Write your first book");
  await page.reload();
  await expect(page.getByRole("button", { name: "New project" })).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem("cadabracraft.locale"))).toBe("pseudo");
});
