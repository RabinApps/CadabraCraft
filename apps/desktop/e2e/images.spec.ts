import { expect, test, type Page } from "./support/coverage";
import { fakeTauri } from "./support/fakeTauri";
import { newProject, exportBook, seedChapters } from "./support/helpers";

test.beforeEach(async ({ page }) => {
  await fakeTauri(page);
});

test.describe("images", () => {
  const tb = (page: Page, name: string) =>
    page.getByRole("toolbar", { name: "Formatting" }).getByRole("button", { name, exact: true });

  test("inserts an imported image with alt and caption, shows it, saves a relative path and exports it", async ({
    page,
  }) => {
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
    await expect
      .poll(() => img.evaluate((i: HTMLImageElement) => i.complete && i.naturalWidth))
      .toBe(1);
    await expect(page.locator(".ProseMirror figure figcaption")).toHaveText("Figure one");

    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByRole("status")).toHaveText("Saved");
    const saved = await page.evaluate(
      () => window.__disk["manuscript/001-chapter-one.json"] as string,
    );
    expect(
      JSON.parse(saved).content.find((n: { type: string; attrs?: object }) => n.type === "image")
        .attrs,
    ).toMatchObject({
      src: "assets/pic.png",
      alt: "A single pixel",
      title: "Figure one",
    });
    expect(saved).not.toContain("blob:");

    await exportBook(page, "EPUB 3");
    await expect(page.getByRole("status")).toHaveText("Exported exports/en/book.epub");
    const zipText = await page.evaluate(() =>
      String.fromCharCode(...(window.__disk["exports/en/book.epub"] as number[])),
    );
    expect(zipText).toContain("OEBPS/assets/pic.png");

    // Reopening resolves the stored relative path again.
    await page.reload();
    await page.getByRole("button", { name: "Open folder" }).click();
    await expect(page.locator(".ProseMirror figure img")).toHaveAttribute("src", /^blob:/);
  });

  test("an image needs a description or the decorative flag, and both can be edited afterwards", async ({
    page,
  }) => {
    await newProject(page);
    await page.locator(".ProseMirror p").last().click();
    await tb(page, "Image").click();
    const dialog = page.getByRole("dialog", { name: "Add image" });
    await dialog.getByRole("button", { name: "Insert" }).click();
    await expect(dialog.getByRole("alert")).toContainText("Describe the image");
    await expect(page.locator(".ProseMirror figure")).toHaveCount(0);

    await dialog.getByLabel("This image is decorative").check();
    await expect(dialog.getByLabel("Description (alt text)")).toBeDisabled();
    await dialog.getByRole("button", { name: "Insert" }).click();
    const img = page.locator(".ProseMirror figure img");
    await expect(img).toHaveAttribute("alt", "");
    const saved = async () => {
      await page.getByRole("button", { name: "Save" }).click();
      await expect(page.getByRole("status")).toHaveText("Saved");
      const json = await page.evaluate(
        () => window.__disk["manuscript/001-chapter-one.json"] as string,
      );
      return JSON.parse(json).content.find((n: { type: string }) => n.type === "image").attrs;
    };
    expect(await saved()).toMatchObject({ alt: "", decorative: true });

    // Select the image and give it a description.
    await page.locator(".ProseMirror p").last().click();
    await tb(page, "More formatting").click();
    await expect(page.getByRole("menuitem", { name: "Image details" })).toBeDisabled();
    await page.keyboard.press("Escape");
    await img.click();
    await tb(page, "More formatting").click();
    await page.getByRole("menuitem", { name: "Image details" }).click();
    const edit = page.getByRole("dialog", { name: "Image details" });
    await expect(edit.getByLabel("This image is decorative")).toBeChecked();
    await edit.getByLabel("This image is decorative").uncheck();
    await edit.getByLabel("Description (alt text)").fill("A single pixel");
    await edit.getByRole("button", { name: "Save" }).click();
    await expect(img).toHaveAttribute("alt", "A single pixel");
    expect(await saved()).toMatchObject({ alt: "A single pixel", decorative: false });
  });

  test("Print PDF, Word and Rich Text warn about images without a description, not decorative ones", async ({
    page,
  }) => {
    await newProject(page);
    const heading = {
      type: "heading",
      attrs: { level: 1 },
      content: [{ type: "text", text: "Pics" }],
    };
    await seedChapters(page, [
      {
        ...{ type: "doc" },
        content: [
          heading,
          { type: "image", attrs: { src: "assets/pic.png", alt: "" } } as never,
          { type: "image", attrs: { src: "assets/pic.png", alt: "", decorative: true } } as never,
        ],
      },
    ]);
    await page.getByRole("button", { name: "Export", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Export book" });
    for (const format of ["Print PDF", "Word", "Rich Text"]) {
      await dialog.getByRole("radio", { name: new RegExp(format) }).click();
      await expect(dialog.getByRole("list", { name: "Image checks" })).toContainText(
        "“Pics” has 1 image without alt text",
      );
    }
    await dialog.getByRole("radio", { name: /Markdown/ }).click();
    await expect(dialog.getByRole("list", { name: "Image checks" })).toHaveCount(0);
  });

  test("a refused image shows a message and inserts nothing", async ({ page }) => {
    await newProject(page);
    await page.evaluate(() => {
      window.__importError = "pic.png is larger than 25 MB";
    });
    await tb(page, "Image").click();
    await expect(page.getByRole("alert")).toContainText(
      "Could not add the image: pic.png is larger than 25 MB",
    );
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.locator(".ProseMirror figure")).toHaveCount(0);
  });
});
