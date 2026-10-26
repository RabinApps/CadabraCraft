import { expect, test, type Page } from "@playwright/test";

// The Tauri backend is replaced with an in-memory fake of the same commands (persisted in sessionStorage so
// reloads work), so the real UI, TipTap editor, store and EPUB exporter run in a plain browser.
// Backend behaviour is covered by the Rust tests in src-tauri/src/project.
async function fakeTauri(page: Page) {
  await page.addInitScript(() => {
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

const prompts = ["E2E Book", "Tester"];
async function newProject(page: Page) {
  page.on("dialog", (d) => (d.type() === "prompt" ? d.accept(prompts.shift() ?? "x") : d.accept()));
  await page.goto("/");
  await page.getByRole("button", { name: "New project…" }).click();
  await expect(page.getByRole("navigation", { name: "Chapters" })).toBeVisible();
}
const titles = (page: Page) => page.getByRole("navigation", { name: "Chapters" }).locator("li > button[aria-current]").allTextContents();

test.beforeEach(async ({ page }) => {
  prompts.splice(0, prompts.length, "E2E Book", "Tester");
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
  await page.getByRole("button", { name: "Open project…" }).click();
  await expect(page.locator(".ProseMirror")).toContainText("Hello from Playwright");
});

test("switching chapters keeps unsaved typing", async ({ page }) => {
  await newProject(page);
  await page.locator(".ProseMirror").click();
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.type("first chapter text");
  await page.getByRole("button", { name: "+ Add chapter" }).click();
  await expect(page.locator(".ProseMirror h1")).toHaveText("Chapter 2");
  await page.getByRole("button", { name: "Chapter One", exact: true }).click();
  await expect(page.locator(".ProseMirror")).toContainText("first chapter text");
});

test("rename, reorder and delete chapters", async ({ page }) => {
  await newProject(page);
  await page.getByRole("button", { name: "+ Add chapter" }).click();
  await page.getByRole("button", { name: "Rename Chapter 2" }).click();
  await page.getByLabel("Chapter title").fill("Second");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("button", { name: "Second", exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Move Second up" }).click();
  const order = await page.evaluate(() => JSON.parse((window as any).__disk["cadabra.json"]).chapters.map((c: any) => c.title));
  expect(order).toEqual(["Second", "Chapter One"]);

  await page.getByRole("button", { name: "Delete Second" }).click();
  await expect(page.getByRole("button", { name: "Second", exact: true })).toHaveCount(0);
  const trashed = await page.evaluate(() => Object.keys((window as any).__disk).filter((k) => k.startsWith(".cadabra/trash/")));
  expect(trashed).toHaveLength(1);
});

test("keyboard: chapter controls are reachable with Tab", async ({ page }) => {
  await newProject(page);
  await page.getByRole("button", { name: "Chapter One", exact: true }).focus();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "Rename Chapter One" })).toBeFocused();
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
