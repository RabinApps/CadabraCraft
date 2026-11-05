import { expect, test, type Page } from "./support/coverage";
import { fakeImportTauri, type ImportPick } from "./support/fakeImport";
import { newProject } from "./support/helpers";

const chapterNav = (page: Page) => page.getByRole("navigation", { name: "Chapters" });

/** An open book, the Import into this book dialog and its preview step for the picked outline. */
async function previewInto(page: Page, pick: ImportPick) {
  await fakeImportTauri(page, pick, false);
  await newProject(page);
  await page.waitForFunction(() =>
    Boolean((window as never as { __cadabraMenu?: unknown }).__cadabraMenu),
  );
  await page.evaluate(() =>
    (window as never as { __cadabraMenu: { run: (id: string) => boolean } }).__cadabraMenu.run(
      "file.importInto",
    ),
  );
  const dialog = page.getByRole("dialog", { name: "Import into this book" });
  await dialog.getByRole("button", { name: "Choose file…" }).click();
  await dialog.getByRole("button", { name: "Next" }).click();
  return dialog;
}

const files = (page: Page) => page.evaluate(() => Object.keys(window.__disk));

test("an OPML outline shows its scenes in the preview, and adds chapters with scenes after the existing ones", async ({
  page,
}) => {
  const dialog = await previewInto(page, "opml");
  await expect(dialog.getByRole("textbox", { name: "Title of chapter 1" })).toHaveValue("Arrival");
  await expect(dialog.getByRole("listitem").filter({ hasText: "2 scenes" })).toHaveCount(1);
  await expect(dialog.getByRole("listitem").filter({ hasText: "1 scene" })).toHaveCount(1);
  // An .opml file is always an outline: nothing to choose between, and no heading level to split at.
  await expect(dialog.getByRole("radio", { name: "Outline" })).toHaveCount(0);
  await expect(dialog.getByRole("radio", { name: "Heading 1" })).toHaveCount(0);
  await expect(dialog.getByRole("status")).toContainText(
    "2 chapters and 3 scenes will be imported.",
  );
  await expect(dialog.getByRole("status")).toContainText("outline-cast-skipped");
  const before = await page.evaluate(() => window.__disk["manuscript/001-chapter-one.json"]);
  await dialog.getByRole("button", { name: "Add to book", exact: true }).click();
  const report = page.getByRole("dialog", { name: "Import report" });
  await expect(report).toContainText("Imported 2 chapters from outline.opml.");
  await expect(report.getByRole("region", { name: "Import warnings" })).toContainText(
    "outline-cast-skipped",
  );
  await report.getByRole("button", { name: "Done" }).click();
  await expect(
    chapterNav(page).getByRole("button", { name: "Arrival", exact: true }),
  ).toBeVisible();
  await expect(
    chapterNav(page).getByRole("button", { name: "Departure", exact: true }),
  ).toBeVisible();
  expect(await page.evaluate(() => window.__disk["manuscript/001-chapter-one.json"])).toBe(before);
  const arrival = await page.evaluate(() =>
    JSON.parse(window.__disk["manuscript/002-arrival.json"] as string),
  );
  expect(arrival.content[1]).toMatchObject({
    type: "scene",
    attrs: {
      title: "The quay at dusk",
      synopsis: "Mara waits & hides.",
      pov: "Mara",
      status: "draft",
      target: 1200,
      date: "2024-05-01",
    },
  });
  expect(arrival.content[1].attrs.id).toMatch(/^sc-/);
  expect(arrival.content[2].attrs.title).toBe("The letter");
  // The source was only read.
  const writes = await page.evaluate(
    () =>
      window.__calls!.filter(
        (c) =>
          /^(write|create|import_asset|trash)/.test(c.cmd) &&
          JSON.stringify(c.args).includes("/src/"),
      ).length,
  );
  expect(writes).toBe(0);
});

test("a Markdown file is read as a manuscript until the author says it is an outline", async ({
  page,
}) => {
  const dialog = await previewInto(page, "outlineMd");
  await expect(dialog.getByRole("radio", { name: "Manuscript" })).toBeChecked();
  await expect(dialog.getByRole("radio", { name: "Heading 1" })).toBeVisible();
  await expect(dialog.getByRole("listitem").first()).toContainText("words");
  await dialog.getByRole("radio", { name: "Outline" }).click();
  await expect(dialog.getByRole("radio", { name: "Outline" })).toBeChecked();
  await expect(dialog.getByRole("radio", { name: "Heading 1" })).toHaveCount(0);
  await expect(dialog.getByRole("textbox", { name: "Title of chapter 1" })).toHaveValue("Arrival");
  await expect(dialog.getByRole("status")).toContainText(
    "2 chapters and 3 scenes will be imported.",
  );
  await expect(dialog.getByRole("status")).toContainText("Nothing was lost or changed.");
  // Going back to a manuscript restores the heading level control and the word counts.
  await dialog.getByRole("radio", { name: "Manuscript" }).click();
  await expect(dialog.getByRole("radio", { name: "Heading 1" })).toBeVisible();
  await dialog.getByRole("radio", { name: "Outline" }).click();
  await dialog.getByRole("button", { name: "Add to book", exact: true }).click();
  await page
    .getByRole("dialog", { name: "Import report" })
    .getByRole("button", { name: "Done" })
    .click();
  const departure = await page.evaluate(() =>
    JSON.parse(window.__disk["manuscript/003-departure.json"] as string),
  );
  expect(departure.content[1]).toMatchObject({ type: "scene", attrs: { title: "Low tide" } });
});

test("a CSV outline creates a new book with its chapters and scenes", async ({ page }) => {
  await fakeImportTauri(page, "csv");
  await page.goto("/");
  await page.getByRole("button", { name: "Import…" }).click();
  const dialog = page.getByRole("dialog", { name: "Import a manuscript" });
  await dialog.getByRole("button", { name: "Choose file…" }).click();
  await dialog.getByRole("button", { name: "Choose…" }).click();
  await dialog.getByRole("button", { name: "Next" }).click();
  await expect(dialog.getByRole("listitem").filter({ hasText: "2 scenes" })).toHaveCount(1);
  await dialog.getByRole("button", { name: "Import", exact: true }).click();
  const report = page.getByRole("dialog", { name: "Import report" });
  await expect(report).toContainText("Imported 2 chapters from outline.csv.");
  await report.getByRole("button", { name: "Done" }).click();
  await expect(
    chapterNav(page).getByRole("button", { name: "Arrival", exact: true }),
  ).toBeVisible();
  expect(await files(page)).toEqual(
    expect.arrayContaining([
      "cadabra.json",
      "manuscript/001-arrival.json",
      "manuscript/002-departure.json",
    ]),
  );
});

test("a malformed outline shows what to do next, creates nothing and leaves the dialog usable", async ({
  page,
}) => {
  await fakeImportTauri(page, "badOpml");
  await page.goto("/");
  await page.getByRole("button", { name: "Import…" }).click();
  const dialog = page.getByRole("dialog", { name: "Import a manuscript" });
  await dialog.getByRole("button", { name: "Choose file…" }).click();
  await dialog.getByRole("button", { name: "Choose…" }).click();
  await dialog.getByRole("button", { name: "Next" }).click();
  await expect(dialog.getByRole("alert")).toContainText("damaged or not written correctly");
  await expect(dialog.getByRole("button", { name: "Next" })).toBeEnabled();
  expect(await files(page)).toEqual([]);
});
