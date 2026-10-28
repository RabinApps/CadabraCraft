import { expect, type Page } from "@playwright/test";

export async function newProject(page: Page) {
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
export const titles = (page: Page) =>
  page
    .getByRole("navigation", { name: "Chapters" })
    .locator("li > button[aria-current='true']")
    .allTextContents();

export async function chapterAction(page: Page, chapter: string, item: string) {
  await page.getByRole("button", { name: `Actions for ${chapter}` }).click();
  await page.getByRole("menuitem", { name: item }).click();
}

export const noVoices = () => {
  window.__audioVoices = [
    { id: "kokoro-heart", engine: "kokoro", installed: false },
    { id: "piper-amy", engine: "piper", installed: false },
  ];
  window.__audioPacks = [
    { id: "piper", voices: ["piper-amy"], bytes: 147993194, installed: false },
    { id: "kokoro", voices: ["kokoro-heart"], bytes: 359719088, installed: false },
  ];
};

export async function addPage(page: Page, name: string) {
  await page.getByRole("button", { name: "Add page" }).click();
  await page.getByRole("menuitem", { name, exact: true }).click();
}
export const manifestOf = (page: Page) =>
  page.evaluate(() => JSON.parse(window.__disk["cadabra.json"] as string));
export const sidebar = (page: Page) => page.getByRole("navigation", { name: "Chapters" });

export async function exportBook(page: Page, format: "EPUB 3" | "Print PDF") {
  await page.getByRole("button", { name: "Export", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Export book" });
  await dialog.getByRole("radio", { name: format }).click();
  await dialog.getByRole("button", { name: "Export", exact: true }).click();
  await expect(dialog).toHaveCount(0);
}

export async function seedSnapshot(page: Page, words: string) {
  return page.evaluate((w) => {
    const disk = window.__disk;
    const file = JSON.parse(disk["cadabra.json"] as string).chapters[0].files.en as string;
    const doc = {
      type: "doc",
      content: [
        { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "Chapter One" }] },
        { type: "paragraph", content: [{ type: "text", text: w }] },
      ],
    };
    const path = `.cadabra/backups/20261027-1000-${file.replaceAll("/", "__")}`;
    disk[path] = JSON.stringify(doc);
    sessionStorage.setItem("disk", JSON.stringify(disk));
    return { file, path };
  }, words);
}
