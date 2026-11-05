import { expect, test, type Page } from "./support/coverage";
import { fakeTauri } from "./support/fakeTauri";
import { newProject } from "./support/helpers";

test.beforeEach(async ({ page }) => {
  await fakeTauri(page);
});

const text = (page: Page, file: string) =>
  page.evaluate((f) => String.fromCharCode(...(window.__disk[f] as number[])), file);

/** A chapter with one scene that has a title and a synopsis, and an opened Outline panel. */
async function openOutline(page: Page) {
  await newProject(page);
  await page
    .getByRole("list", { name: "Scenes in Chapter One" })
    .getByRole("button", { name: "Scene", exact: true })
    .click();
  await page.keyboard.type("Secret prose that must stay out.");
  const rail = page.getByRole("region", { name: "Scene" });
  await rail.getByLabel("Scene title").fill("The quay at dusk");
  await rail.getByLabel("Scene title").blur();
  await rail.getByLabel("Synopsis").fill("Mara waits & <hides>.");
  await rail.getByLabel("Synopsis").blur();
  await expect(page.getByRole("status")).toContainText("Saved");
  await page.getByRole("button", { name: "Export", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Export book" });
  await dialog.getByRole("radio", { name: "Outline" }).click();
  return dialog;
}

test("Export outline writes OPML by default, with the scene notes and none of the text", async ({
  page,
}) => {
  const dialog = await openOutline(page);
  await expect(dialog.getByRole("radio", { name: "OPML (.opml)" })).toBeChecked();
  await expect(dialog.getByRole("button", { name: "Print preview" })).toHaveCount(0);
  await dialog.getByRole("button", { name: "Export", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole("status")).toHaveText("Exported exports/en/outline.opml");
  const opml = await text(page, "exports/en/outline.opml");
  expect(opml).toContain('text="The quay at dusk"');
  expect(opml).toContain("Mara waits &amp; &lt;hides&gt;.");
  expect(opml).not.toContain("Secret prose");
});

test("Export outline writes Markdown and CSV when chosen", async ({ page }) => {
  const dialog = await openOutline(page);
  await dialog.getByRole("radio", { name: "Markdown (.md)" }).click();
  await dialog.getByRole("button", { name: "Export", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("Exported exports/en/outline.md");
  expect(await text(page, "exports/en/outline.md")).toContain("The quay at dusk");

  await page.getByRole("button", { name: "Export", exact: true }).click();
  await dialog.getByRole("radio", { name: "Outline" }).click();
  await dialog.getByRole("radio", { name: "CSV (.csv)" }).click();
  await dialog.getByRole("button", { name: "Export", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("Exported exports/en/outline.csv");
  const csv = await text(page, "exports/en/outline.csv");
  expect(csv).toContain("chapter_number");
  expect(csv).toContain("The quay at dusk");
  expect(csv).not.toContain("Secret prose");
});
