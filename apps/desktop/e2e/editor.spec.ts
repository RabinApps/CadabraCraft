import { expect, test, type Page } from "@playwright/test";

// The Tauri backend is replaced with an in-memory fake of the same commands, so the real UI, TipTap
// editor and EPUB exporter run in a plain browser. Backend behaviour is covered by cargo tests.
async function fakeTauri(page: Page) {
  await page.addInitScript(() => {
    const files: Record<string, unknown> = JSON.parse(sessionStorage.getItem("files") ?? "{}");
    const w = window as any;
    w.__files = files;
    w.__TAURI_INTERNALS__ = {
      transformCallback: () => 0,
      invoke: async (cmd: string, args: any) => {
        if (cmd === "load_chapter") return files[args.path] ?? null;
        if (cmd === "save_chapter" || cmd === "save_bytes") {
          files[args.path] = cmd === "save_chapter" ? args.doc : args.bytes;
          sessionStorage.setItem("files", JSON.stringify(files));
          return null;
        }
        throw new Error(`unexpected command ${cmd}`);
      },
    };
  });
}

test.beforeEach(async ({ page }) => {
  await fakeTauri(page);
  await page.goto("/");
});

test("loads a default chapter", async ({ page }) => {
  await expect(page.locator(".ProseMirror h1")).toHaveText("Chapter One");
});

test("typing then saving writes TipTap JSON, and reload restores it", async ({ page }) => {
  await page.locator(".ProseMirror").click();
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.type("Hello from Playwright");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Saved")).toBeVisible();
  const saved = await page.evaluate(() => (window as any).__files["spike/001-chapter-one.json"]);
  expect(JSON.stringify(saved)).toContain("Hello from Playwright");
  await page.reload();
  await expect(page.locator(".ProseMirror")).toContainText("Hello from Playwright");
});

test("export produces a valid EPUB zip with mimetype first", async ({ page }) => {
  await page.getByRole("button", { name: "Export EPUB" }).click();
  await expect(page.getByText("Exported spike/chapter-one.epub")).toBeVisible();
  const head = await page.evaluate(() => {
    const b: number[] = (window as any).__files["spike/chapter-one.epub"];
    return String.fromCharCode(...b.slice(0, 4), ...b.slice(30, 38));
  });
  expect(head).toBe("PK\u0003\u0004mimetype");
});
