import { expect, test } from "./support/coverage";
import { fakeTauri } from "./support/fakeTauri";
import { newProject } from "./support/helpers";

test.beforeEach(async ({ page }) => {
  await fakeTauri(page);
});

test("templates page sets the book's template from the details panel", async ({ page }) => {
  await newProject(page);
  await page.getByRole("button", { name: "Change template" }).click();
  await expect(page.getByRole("heading", { name: "Choose a look for your book" })).toBeVisible();
  await page.getByRole("radio", { name: /^Poetry/ }).click();
  await page.getByRole("button", { name: "Use template" }).click();
  await expect(page.getByRole("navigation", { name: "Chapters" })).toBeVisible();
  const manifest = await page.evaluate(() => JSON.parse(window.__disk["cadabra.json"] as string));
  expect(manifest.template).toBe("poetry");
});

test("print preview opens from the export dialog and returns to the book", async ({ page }) => {
  await newProject(page);
  await page.getByRole("button", { name: "Export", exact: true }).click();
  await page
    .getByRole("dialog", { name: "Export book" })
    .getByRole("button", { name: "Print preview" })
    .click();
  await expect(page.getByRole("heading", { name: "Print preview" })).toBeVisible();
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await expect(page.locator(".ProseMirror")).toBeVisible();
});

test("Book details: edit the title, pick a cover, save, then remove the cover", async ({
  page,
}) => {
  await newProject(page);
  const manifest = () => page.evaluate(() => JSON.parse(window.__disk["cadabra.json"] as string));
  await page.getByRole("button", { name: "Book details" }).click();
  const dialog = page.getByRole("dialog", { name: "Book details" });
  await dialog.getByLabel("Title").fill("Renamed Book");
  await dialog.getByLabel("ISBN").fill("978-3-16-148410-0");
  await dialog.getByRole("button", { name: "Choose image…" }).click();
  await expect(dialog.getByRole("img", { name: "Cover preview" })).toBeVisible();
  await dialog.getByRole("button", { name: "Save details" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole("heading", { level: 1, name: "Renamed Book" })).toBeVisible();
  expect(await manifest()).toMatchObject({
    editions: [{ title: "Renamed Book", isbn: "978-3-16-148410-0", cover: "assets/pic.png" }],
  });

  await page.getByRole("button", { name: "Book details" }).click();
  await dialog.getByLabel("Title").fill("");
  await dialog.getByRole("button", { name: "Save details" }).click();
  await expect(dialog.getByRole("alert")).toHaveText("Give the book a title.");
  await dialog.getByLabel("Title").fill("Renamed Book");
  await dialog.getByRole("button", { name: "Remove cover" }).click();
  await dialog.getByRole("button", { name: "Save details" }).click();
  await expect(dialog).toBeHidden();
  expect((await manifest()).editions[0].cover).toBeNull();
});

test("Book details: publishing details save to the book, a wrong value is explained, and clearing them removes them", async ({
  page,
}) => {
  await newProject(page);
  const manifest = () => page.evaluate(() => JSON.parse(window.__disk["cadabra.json"] as string));
  await page.getByRole("button", { name: "Book details" }).click();
  const dialog = page.getByRole("dialog", { name: "Book details" });
  await dialog.getByText("Publishing details").click();
  await dialog.getByLabel("Publisher").fill("Quay Press");
  await dialog.getByLabel("Series", { exact: true }).fill("Harbour Lights");
  await dialog.getByLabel("Number in series").fill("one");
  await dialog.getByRole("button", { name: "Save details" }).click();
  await expect(dialog.getByRole("alert")).toHaveText("Use a number such as 1 or 2.5.");
  await expect(dialog.getByLabel("Number in series")).toHaveAttribute("aria-invalid", "true");
  await dialog.getByLabel("Number in series").fill("2");
  await dialog.getByLabel("Publication date").fill("2026-11-03");
  await dialog.getByLabel("Subjects").fill("FIC014000\nLighthouses");
  await dialog.getByLabel("Description").fill("A keeper and a storm.");
  await dialog.getByLabel("Rights").fill("© 2026 A. Writer");
  await dialog.getByRole("button", { name: "Save details" }).click();
  await expect(dialog).toBeHidden();
  expect((await manifest()).editions[0].publishing).toEqual({
    publisher: "Quay Press",
    description: "A keeper and a storm.",
    subjects: ["FIC014000", "Lighthouses"],
    series: "Harbour Lights",
    seriesNumber: "2",
    rights: "© 2026 A. Writer",
    published: "2026-11-03",
  });

  await page.getByRole("button", { name: "Book details" }).click();
  await dialog.getByText("Publishing details").click();
  await expect(dialog.getByLabel("Publisher")).toHaveValue("Quay Press");
  for (const label of ["Publisher", "Rights", "Subjects", "Description", "Publication date"])
    await dialog.getByLabel(label).fill("");
  await dialog.getByLabel("Series", { exact: true }).fill("");
  await dialog.getByLabel("Number in series").fill("");
  await dialog.getByRole("button", { name: "Save details" }).click();
  await expect(dialog).toBeHidden();
  expect((await manifest()).editions[0]).not.toHaveProperty("publishing");
});

test("print preview shows the cover, and the PDF dialog offers to include it only when there is one", async ({
  page,
}) => {
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
  await expect(page.getByRole("img", { name: "Page 1", exact: true })).toBeVisible();
  await expect(
    page.getByText("The cover is the first page, with a blank page behind it"),
  ).toBeVisible();
});
