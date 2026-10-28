import { expect, test, type Page } from "@playwright/test";
import { fakeTauri } from "./support/fakeTauri";
import { newProject, exportBook } from "./support/helpers";

test.beforeEach(async ({ page }) => {
  await fakeTauri(page);
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
