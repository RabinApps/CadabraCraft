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
    { id: "kokoro-heart", engine: "kokoro", installed: false, languages: ["en"] },
    { id: "piper-amy", engine: "piper", installed: false, languages: ["en"] },
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

type DocNode = { type: string; content?: DocNode[]; text?: string };

/**
 * Replaces the new project's chapters with `docs` (one chapter per document, titled by its first heading, ids chapter-1, chapter-2,
 * ...) on the fake disk and reopens the book, so a test can read a book of any size.
 */
export async function seedChapters(page: Page, docs: { content: DocNode[] }[]) {
  await page.evaluate((list) => {
    const disk = window.__disk;
    const m = JSON.parse(disk["cadabra.json"] as string);
    const lang = Object.keys(m.chapters[0].files)[0]!;
    const first = m.chapters[0].files[lang] as string;
    const heading = (d: { content: DocNode[] }) => d.content[0]?.content?.[0]?.text ?? "Chapter";
    m.chapters = list.map((d, i) => {
      const file = i === 0 ? first : `manuscript/${String(i + 1).padStart(3, "0")}-chapter.json`;
      disk[file] = JSON.stringify(d);
      return { id: `chapter-${i + 1}`, titles: { [lang]: heading(d) }, files: { [lang]: file } };
    });
    disk["cadabra.json"] = JSON.stringify(m);
    sessionStorage.setItem("disk", JSON.stringify(disk));
  }, docs);
  await page.reload();
  await page.getByRole("button", { name: "Open folder" }).click();
  await expect(page.locator(".ProseMirror h1").first()).toBeVisible();
}

/** A chapter document: a heading and `paragraphs` paragraphs of `words` words each (so the page count is predictable). */
export function chapterDoc(title: string, paragraphs: number, words = 40, seed = 0) {
  const vocab = ["quiet", "garden", "river", "stone", "letter", "morning", "lantern", "orchard"];
  return {
    type: "doc",
    content: [
      { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: title }] },
      ...Array.from({ length: paragraphs }, (_, p) => ({
        type: "paragraph",
        content: [
          {
            type: "text",
            text:
              Array.from(
                { length: words },
                (_, i) => vocab[(i * 7 + p + seed) % vocab.length],
              ).join(" ") + ".",
          },
        ],
      })),
    ],
  };
}

/** A book with two chapters and a French edition in which only the open chapter has been written. */
export async function frenchWithOneChapter(page: Page) {
  await newProject(page);
  // Below the lg breakpoint the chapter list is a drawer.
  const drawer = page.getByRole("button", { name: "Show chapters" });
  if (await drawer.isVisible()) await drawer.click();
  await page.getByRole("button", { name: "Add chapter" }).click();
  const close = page.getByRole("button", { name: "Close chapters" });
  if (await close.isVisible()) await close.click();
  await page.getByRole("button", { name: /Edition: English/ }).click();
  await page.getByRole("menuitem", { name: "Add language" }).click();
  const add = page.getByRole("dialog", { name: "Add language" });
  await add.getByLabel("Language", { exact: true }).selectOption("fr");
  await add.getByRole("button", { name: "Add language", exact: true }).click();
  await expect(page.getByRole("button", { name: /Edition: Français/ })).toBeVisible();
  await page.locator(".ProseMirror").click();
  await page.keyboard.type(" Bonjour");
  await expect(page.getByRole("status")).toContainText("Saved");
}

/**
 * Puts the caret at the end of the open chapter. The page surface sinks the chapter title below the page's top margin, so a click in
 * the middle of the editor lands on the title; a click at the bottom edge is below the last block, where ProseMirror puts the caret
 * at the end of the document.
 */
export async function focusEnd(page: Page) {
  const pm = page.locator(".ProseMirror").first();
  const box = await pm.boundingBox();
  await pm.click({ position: { x: 4, y: Math.max(1, box!.height - 4) } });
  await page.keyboard.press("ControlOrMeta+End");
}

/** Makes the page surface ask Typst again (a canned answer is set after the chapter was first measured): Read mode and back remounts it. */
export async function remeasure(page: Page) {
  await page.getByRole("radio", { name: "Read" }).click();
  await page.getByRole("radio", { name: "Write" }).click();
  await expect(page.locator(".page").first()).toBeVisible();
}
