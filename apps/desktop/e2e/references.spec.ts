import { expect, test, type Page } from "./support/coverage";
import { fakeTauri } from "./support/fakeTauri";
import { manifestOf, newProject } from "./support/helpers";

test.beforeEach(async ({ page }) => {
  await fakeTauri(page);
});

const bytes = (s: string) => Array.from(s, (c) => c.charCodeAt(0));
const PDF = bytes(
  "%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R 4 0 R]/Count 2>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 100]>>endobj\n4 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 100]>>endobj\ntrailer<</Root 1 0 R/Size 5>>\n%%EOF",
);
/** Two pages with text: "Storm on the third" and "Calm seas, storm warning". */
const TEXT_PDF = (() => {
  const page = (n: number, text: string) => {
    const body = `BT /F1 12 Tf 10 50 Td (${text}) Tj ET`;
    return `${n} 0 obj<</Length ${body.length}>>stream\n${body}\nendstream endobj\n`;
  };
  return bytes(
    "%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R 4 0 R]/Count 2>>endobj\n" +
      "3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 100]/Contents 5 0 R/Resources<</Font<</F1 7 0 R>>>>>>endobj\n" +
      "4 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 100]/Contents 6 0 R/Resources<</Font<</F1 7 0 R>>>>>>endobj\n" +
      page(5, "Storm on the third") +
      page(6, "Calm seas, storm warning") +
      "7 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj\ntrailer<</Root 1 0 R/Size 8>>\n%%EOF",
  );
})();
const PIXEL = Array.from(
  atob(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  ),
  (c) => c.charCodeAt(0),
);

/** Opens a book, shows the References panel and adds the given files (path to bytes). */
async function withReferences(page: Page, files: Record<string, number[]>) {
  await newProject(page);
  await page.evaluate(
    ([paths, contents]) => {
      window.__pickedRefs = paths as string[];
      window.__refFiles = contents as Record<string, number[]>;
    },
    [Object.keys(files), files] as const,
  );
  await page.getByRole("button", { name: "References", exact: true }).first().click();
  await page.getByRole("button", { name: "Add files" }).click();
  await expect(panel(page).getByRole("list").getByRole("listitem")).toHaveCount(
    Object.keys(files).length,
  );
}

const panel = (page: Page) => page.getByRole("region", { name: "References" });
const row = (page: Page, name: string) => panel(page).getByRole("button", { name, exact: true });

test.describe("reference files", () => {
  test("shows an empty library, adds files and keeps them in the manifest", async ({ page }) => {
    await newProject(page);
    await page.getByRole("button", { name: "References", exact: true }).first().click();
    await expect(panel(page).getByText("Keep your research close")).toBeVisible();
    await page.evaluate(() => {
      window.__pickedRefs = ["/refs/Harbour at dusk.mp4", "/refs/notes.md", "/refs/map.png"];
    });
    await page.getByRole("button", { name: "Add files" }).click();
    await expect(row(page, "Harbour at dusk")).toBeVisible();
    await expect(row(page, "notes")).toContainText("Document");
    await expect(row(page, "map")).toContainText("Image");
    const m = await manifestOf(page);
    expect(m.formatVersion).toBe(8);
    expect(m.references.map((r: { id: string; file: string }) => [r.id, r.file])).toEqual([
      ["ref-1", "references/Harbour-at-dusk.mp4"],
      ["ref-2", "references/notes.md"],
      ["ref-3", "references/map.png"],
    ]);
    await page.reload();
    await page.getByRole("button", { name: "Open folder" }).click();
    await expect(row(page, "notes")).toBeVisible(); // the panel stays open across restarts
  });

  test("does nothing when the picker is cancelled", async ({ page }) => {
    await newProject(page);
    await page.getByRole("button", { name: "References", exact: true }).first().click();
    await page.getByRole("button", { name: "Add files" }).click();
    await expect(panel(page).getByText("Keep your research close")).toBeVisible();
  });

  test("searches, filters by type and by tag", async ({ page }) => {
    await withReferences(page, {
      "/refs/lighthouse.pdf": PDF,
      "/refs/dusk.mp4": [1, 2],
      "/refs/map.png": PIXEL,
    });
    await row(page, "map").click();
    const viewer = page.getByRole("dialog");
    await viewer.getByLabel("Add a tag").fill("history");
    await viewer.getByLabel("Add a tag").press("Enter");
    await viewer.getByRole("button", { name: "Close viewer" }).click();
    await panel(page).getByLabel("Search references").fill("LIGHT");
    await expect(panel(page).getByRole("list").getByRole("listitem")).toHaveCount(1);
    await expect(row(page, "lighthouse")).toBeVisible();
    await panel(page).getByLabel("Search references").fill("");
    await panel(page).getByRole("button", { name: "Video", exact: true }).click();
    await expect(panel(page).getByRole("list").getByRole("listitem")).toHaveCount(1);
    await panel(page).getByRole("button", { name: "All", exact: true }).click();
    await panel(page).getByRole("button", { name: "#history" }).click();
    await expect(panel(page).getByRole("list").getByRole("listitem")).toHaveCount(1);
    await expect(row(page, "map")).toBeVisible();
    await panel(page).getByRole("button", { name: "#history" }).click();
    await panel(page).getByLabel("Search references").fill("nothing like this");
    await expect(panel(page).getByText("No references match.")).toBeVisible();
    await panel(page).getByRole("button", { name: "Show as grid" }).click();
    await expect(panel(page).getByRole("button", { name: "Show as list" })).toBeVisible();
  });

  test("shows an image, text, audio, video and an unknown file in the viewer", async ({ page }) => {
    await withReferences(page, {
      "/refs/map.png": PIXEL,
      "/refs/notes.md": bytes("# Keeper's log\nStorm on the 3rd."),
      "/refs/song.mp3": [1, 2, 3],
      "/refs/dusk.mp4": [1, 2, 3],
      "/refs/data.xlsx": [9, 9],
    });
    const viewer = page.getByRole("dialog");
    await row(page, "map").click();
    const img = viewer.getByRole("img", { name: "map" });
    await expect(img).toHaveAttribute("src", /^blob:/);
    await expect.poll(() => img.evaluate((i: HTMLImageElement) => i.naturalWidth)).toBe(1);
    const fit = await img.evaluate((i: HTMLImageElement) => i.clientWidth);
    await viewer.getByRole("button", { name: "Zoom in" }).click();
    await expect
      .poll(() => img.evaluate((i: HTMLImageElement) => i.clientWidth))
      .toBeGreaterThan(fit);
    await expect(viewer.getByRole("button", { name: "Fit to window" })).toBeEnabled();
    // A one-pixel image can be shown up to 48 px wide: Zoom in then has nothing left, and so does Zoom out.
    await expect(viewer.getByRole("button", { name: "Zoom in" })).toBeDisabled();
    await expect(viewer.getByRole("button", { name: "Zoom out" })).toBeDisabled();
    await viewer.getByRole("button", { name: "Fit to window" }).click();
    await expect(viewer.getByRole("button", { name: "Fit to window" })).toBeDisabled();
    await expect.poll(() => img.evaluate((i: HTMLImageElement) => i.clientWidth)).toBe(fit);
    await expect(viewer).toContainText("Image · 70 B");
    await viewer.getByRole("button", { name: "Close viewer" }).click();
    await row(page, "notes").click();
    await expect(viewer.getByLabel("notes").first()).toContainText("Storm on the 3rd.");
    await expect(viewer.getByRole("button", { name: "Open in default app" })).toHaveCount(0);
    await page.keyboard.press("Escape");
    await row(page, "song").click();
    await expect(viewer.locator("audio")).toHaveAttribute("src", /^blob:/);
    await page.keyboard.press("Escape");
    await row(page, "dusk").click();
    await expect(viewer.locator("video")).toHaveAttribute("src", /^blob:/);
    await page.keyboard.press("Escape");
    await row(page, "data").click();
    await expect(viewer.getByText("No preview for this file type")).toBeVisible();
    await viewer.getByRole("button", { name: "Open in default app" }).click();
    await expect
      .poll(() => page.evaluate(() => window.__opened))
      .toEqual(["reference:references/data.xlsx"]);
  });

  test("draws a PDF page by page and zooms", async ({ page }) => {
    await withReferences(page, { "/refs/lighthouse.pdf": PDF });
    await row(page, "lighthouse").click();
    const viewer = page.getByRole("dialog");
    await expect(viewer.getByText("1 / 2")).toBeVisible();
    await expect(viewer.getByRole("button", { name: "Previous page" })).toBeDisabled();
    await viewer.getByRole("button", { name: "Next page" }).click();
    await expect(viewer.getByText("2 / 2")).toBeVisible();
    await expect(viewer.getByRole("button", { name: "Next page" })).toBeDisabled();
    await viewer.getByRole("button", { name: "Previous page" }).click();
    await expect(viewer.getByText("100%")).toBeVisible();
    await viewer.getByRole("button", { name: "Zoom in" }).click();
    await expect(viewer.getByText("125%")).toBeVisible();
    await viewer.getByRole("button", { name: "Zoom out" }).click();
    await expect(viewer.getByText("100%")).toBeVisible();
    const canvas = viewer.getByLabel("PDF page 1");
    await expect
      .poll(() => canvas.evaluate((c: HTMLCanvasElement) => c.width))
      .toBeGreaterThan(100);
  });

  test("searches the text of a PDF, highlights every match and steps through them", async ({
    page,
  }) => {
    await withReferences(page, { "/refs/log.pdf": TEXT_PDF });
    await row(page, "log").click();
    const viewer = page.getByRole("dialog");
    await expect(viewer.getByText("1 / 2")).toBeVisible();
    await viewer.getByRole("button", { name: "Search in PDF" }).click();
    const box = viewer.getByLabel("Search text");
    const current = viewer.locator('[data-match="current"]');
    await box.fill("calm");
    await box.press("Enter");
    await expect(viewer.getByText("Match 1 of 1, page 2 (1 on this page)")).toBeVisible();
    await expect(viewer.getByText("2 / 2")).toBeVisible();
    await expect(current).toHaveCount(1);
    await box.fill("storm");
    await box.press("Enter");
    await expect(viewer.getByText("Match 1 of 2, page 1 (1 on this page)")).toBeVisible();
    await expect(current).toHaveCount(1);
    await expect(viewer.locator("[data-match]")).toHaveCount(1);
    const first = await current.boundingBox();
    const canvas = await viewer.getByLabel("PDF page 1").boundingBox();
    expect(first!.x).toBeGreaterThanOrEqual(canvas!.x);
    expect(first!.width).toBeGreaterThan(5);
    expect(first!.width).toBeLessThan(canvas!.width / 2);
    await expect(viewer.getByRole("button", { name: "Previous match" })).toBeDisabled();
    await viewer.getByRole("button", { name: "Next match" }).click();
    await expect(viewer.getByText("Match 2 of 2, page 2 (1 on this page)")).toBeVisible();
    await expect(viewer.getByText("2 / 2")).toBeVisible();
    await expect(current).toHaveCount(1);
    await viewer.getByRole("button", { name: "Previous match" }).click();
    await expect(viewer.getByText("1 / 2")).toBeVisible();
    await box.press("Enter"); // the same text again steps on
    await expect(viewer.getByText("Match 2 of 2, page 2 (1 on this page)")).toBeVisible();
    await box.press("Enter"); // and wraps round
    await expect(viewer.getByText("Match 1 of 2, page 1 (1 on this page)")).toBeVisible();
    await box.fill("gale");
    await box.press("Enter");
    await expect(viewer.getByText("No matches")).toBeVisible();
    await expect(viewer.locator("[data-match]")).toHaveCount(0);
    await box.fill("storm");
    await box.press("Enter");
    await expect(viewer.locator("[data-match]")).toHaveCount(1);
    await viewer.getByRole("button", { name: "Close search" }).click();
    await expect(box).toBeHidden();
    await expect(viewer.locator("[data-match]")).toHaveCount(0);
    await viewer.getByRole("button", { name: "Search in PDF" }).click(); // open again, then close with the same button
    await expect(box).toBeVisible();
    await viewer.getByRole("button", { name: "Search in PDF" }).click();
    await expect(box).toBeHidden();
  });

  test("says so when a PDF cannot be drawn or a file cannot be read", async ({ page }) => {
    await withReferences(page, { "/refs/broken.pdf": bytes("not a pdf"), "/refs/gone.png": PIXEL });
    await row(page, "broken").click();
    await expect(page.getByRole("dialog").getByRole("alert")).toContainText(
      "Could not show this PDF",
    );
    await page.keyboard.press("Escape");
    await page.evaluate(() => delete window.__disk["references/gone.png"]);
    await row(page, "gone").click();
    await expect(page.getByRole("dialog").getByRole("alert")).toContainText("Could not open gone");
  });

  test("edits title, note and tags, links a chapter and saves each change", async ({ page }) => {
    await withReferences(page, { "/refs/notes.md": bytes("hello") });
    await row(page, "notes").click();
    const viewer = page.getByRole("dialog");
    await viewer.getByLabel("Title", { exact: true }).fill("Keeper's log");
    await viewer.getByLabel("Note", { exact: true }).click();
    await viewer.getByLabel("Note", { exact: true }).fill("Check the tide times.");
    await viewer.getByLabel("Add a tag").fill("tides");
    await viewer.getByLabel("Add a tag").press("Enter");
    await viewer.getByLabel("Add a tag").fill("tides");
    await viewer.getByLabel("Add a tag").blur();
    await viewer.getByLabel("Link to a chapter").selectOption({ label: "Chapter One" });
    await expect(viewer.getByText("Chapter One")).toBeVisible();
    await expect
      .poll(async () => (await manifestOf(page)).references[0])
      .toMatchObject({
        title: "Keeper's log",
        note: "Check the tide times.",
        tags: ["tides"],
        chapters: ["ch-1"],
      });
    await viewer.getByLabel("Title", { exact: true }).fill("   ");
    await viewer.getByLabel("Note", { exact: true }).click();
    await expect(viewer.getByLabel("Title", { exact: true })).toHaveValue("Keeper's log");
    await viewer.getByRole("button", { name: "Remove tag tides" }).click();
    await viewer.getByRole("button", { name: "Unlink Chapter One" }).click();
    await expect
      .poll(async () => (await manifestOf(page)).references[0])
      .toMatchObject({ tags: [], chapters: [] });
  });

  test("links references from the chapter's details and opens them", async ({ page }) => {
    await withReferences(page, { "/refs/notes.md": bytes("hello"), "/refs/map.png": PIXEL });
    await page.getByRole("button", { name: "Details", exact: true }).click();
    const details = page.getByRole("complementary", { name: "Details" });
    await details.getByLabel("Link a reference").selectOption({ label: "notes" });
    await details.getByLabel("Link a reference").selectOption({ label: "map" });
    await expect(details.getByLabel("Link a reference")).toHaveCount(0);
    await details.getByRole("button", { name: "notes" }).click();
    await expect(page.getByRole("dialog")).toContainText("Chapter One");
    await page.keyboard.press("Escape");
    expect(
      (await manifestOf(page)).references.map((r: { chapters: string[] }) => r.chapters),
    ).toEqual([["ch-1"], ["ch-1"]]);
  });

  test("removing a chapter drops its links but keeps the reference", async ({ page }) => {
    await withReferences(page, { "/refs/notes.md": bytes("hello") });
    await row(page, "notes").click();
    await page
      .getByRole("dialog")
      .getByLabel("Link to a chapter")
      .selectOption({ label: "Chapter One" });
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Add chapter" }).click();
    await page.getByRole("button", { name: "Actions for Chapter One" }).click();
    await page.getByRole("menuitem", { name: "Move to trash" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Move to trash" }).click();
    await expect.poll(async () => (await manifestOf(page)).references[0].chapters).toEqual([]);
    await expect(row(page, "notes")).toBeVisible();
    await page.getByRole("button", { name: "Actions for Chapter 2" }).click();
    await page.getByRole("menuitem", { name: "Move to trash" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Move to trash" }).click();
    await page.getByRole("button", { name: "Details", exact: true }).click();
    await expect(page.getByRole("complementary", { name: "Details" })).toBeVisible();
    await expect(page.getByRole("region", { name: "References" })).toHaveCount(0);
  });

  test("chapter titles in the link menu follow the open edition", async ({ page }) => {
    await withReferences(page, { "/refs/notes.md": bytes("hello") });
    await page.getByRole("button", { name: /Edition: English/ }).click();
    await page.getByRole("menuitem", { name: "Add language" }).click();
    const dialog = page.getByRole("dialog", { name: "Add language" });
    await dialog.getByLabel("Language", { exact: true }).selectOption("fr");
    await dialog.getByRole("button", { name: "Add language", exact: true }).click();
    await expect(page.getByRole("button", { name: /Edition: Français/ })).toBeVisible();
    await row(page, "notes").click();
    await page
      .getByRole("dialog")
      .getByLabel("Link to a chapter")
      .selectOption({ label: "Chapter One" });
    await expect(
      page.getByRole("dialog").getByRole("button", { name: "Unlink Chapter One" }),
    ).toBeVisible();
  });

  test("removing a reference moves its file to the trash", async ({ page }) => {
    await withReferences(page, { "/refs/notes.md": bytes("hello"), "/refs/map.png": PIXEL });
    await row(page, "notes").click();
    await page.getByRole("dialog").getByRole("button", { name: "Remove from book" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(row(page, "notes")).toHaveCount(0);
    expect((await manifestOf(page)).references).toHaveLength(1);
    const keys = await page.evaluate(() => Object.keys(window.__disk));
    expect(keys).toContain(".cadabra/trash/20260101-1200-references__notes.md");
    expect(keys).not.toContain("references/notes.md");
  });

  test("reports a refused file and a duplicate, and dismisses the messages", async ({ page }) => {
    await newProject(page);
    await page.evaluate(() => {
      window.__refErrors = { "setup.exe": { kind: "unsupported_reference", name: "setup.exe" } };
      window.__pickedRefs = ["/refs/notes.md", "/refs/setup.exe"];
    });
    await page.getByRole("button", { name: "References", exact: true }).first().click();
    await page.getByRole("button", { name: "Add files" }).click();
    await expect(panel(page).getByRole("alert")).toContainText(
      "Could not add setup.exe: setup.exe is a type of file that cannot be added as a reference",
    );
    await expect(row(page, "notes")).toBeVisible();
    await page.evaluate(() => (window.__pickedRefs = ["/refs/notes.md"]));
    await page.getByRole("button", { name: "Add files" }).click();
    await expect(panel(page).getByRole("status")).toContainText("notes.md is already in this book");
    await panel(page).getByRole("button", { name: "Dismiss" }).click();
    await expect(panel(page).getByRole("status")).toHaveCount(0);
    expect((await manifestOf(page)).references).toHaveLength(1);
  });

  test("adds files dropped on the window while the panel is open", async ({ page }) => {
    await newProject(page);
    await page.getByRole("button", { name: "References", exact: true }).first().click();
    await page.evaluate(() =>
      window.__emit!("tauri://drag-drop", {
        type: "drop",
        paths: ["/refs/dropped.pdf"],
        position: { x: 0, y: 0 },
      }),
    );
    await expect(row(page, "dropped")).toBeVisible();
    await page.evaluate(() =>
      window.__emit!("tauri://drag-drop", { type: "over", position: { x: 0, y: 0 } }),
    );
    await expect(panel(page).getByRole("list").getByRole("listitem")).toHaveCount(1);
  });

  test("the panel and Details swap places, and the choice is remembered", async ({ page }) => {
    await newProject(page);
    await expect(page.getByRole("complementary", { name: "Details" })).toBeVisible();
    await page.getByRole("button", { name: "References", exact: true }).first().click();
    await expect(page.getByRole("complementary", { name: "References" })).toBeVisible();
    await page.reload();
    await page.getByRole("button", { name: "Open folder" }).click();
    await expect(page.getByRole("complementary", { name: "References" })).toBeVisible();
    await page.getByRole("button", { name: "Details", exact: true }).click();
    await expect(page.getByRole("complementary", { name: "Details" })).toBeVisible();
    await page.getByRole("button", { name: "References", exact: true }).first().click();
    await page.getByRole("button", { name: "Details", exact: true }).click();
    await expect(page.getByRole("complementary", { name: "Details" })).toBeVisible();
  });

  test("reorders with the row menu and by dragging the grip, only while nothing is filtered", async ({
    page,
  }) => {
    await withReferences(page, {
      "/refs/one.png": PIXEL,
      "/refs/two.png": PIXEL.slice(0, 60).concat([1]),
      "/refs/three.png": PIXEL.slice(0, 50).concat([2, 3]),
    });
    const titles = () =>
      panel(page)
        .getByRole("listitem")
        .evaluateAll((li) => li.map((x) => x.querySelector("[data-title]")!.textContent));
    await expect.poll(titles).toEqual(["one", "two", "three"]);
    await panel(page).getByRole("button", { name: "Actions for one" }).click();
    await expect(page.getByRole("menuitem", { name: "Move up" })).toBeDisabled();
    await page.getByRole("menuitem", { name: "Move down" }).click();
    await expect.poll(titles).toEqual(["two", "one", "three"]);
    await panel(page).getByRole("button", { name: "Actions for three" }).click();
    await expect(page.getByRole("menuitem", { name: "Move down" })).toBeDisabled();
    await page.getByRole("menuitem", { name: "Move up" }).click();
    await expect.poll(titles).toEqual(["two", "three", "one"]);
    // Drag the first row's grip below the last row.
    const grip = panel(page).locator("[data-grip]").first();
    const last = panel(page).getByRole("listitem").last();
    const g = (await grip.boundingBox())!;
    const l = (await last.boundingBox())!;
    await page.mouse.move(g.x + g.width / 2, g.y + g.height / 2);
    await page.mouse.down();
    await page.mouse.move(g.x + 4, l.y + l.height + 4, { steps: 5 });
    await expect(panel(page).locator("[data-drop-line]")).toHaveCount(1);
    await page.mouse.up();
    await expect.poll(titles).toEqual(["three", "one", "two"]);
    await expect(panel(page).locator("[data-drop-line]")).toHaveCount(0);
    // Dropping where it started changes nothing.
    const g2 = (await panel(page).locator("[data-grip]").first().boundingBox())!;
    await page.mouse.move(g2.x + 4, g2.y + 4);
    await page.mouse.down();
    await page.mouse.move(g2.x + 4, g2.y + 8, { steps: 2 });
    await page.mouse.up();
    await expect.poll(titles).toEqual(["three", "one", "two"]);
    // A filter hides the grips and the menu cannot move rows.
    await panel(page).getByRole("button", { name: "Images" }).click();
    await expect(panel(page).getByText("Clear search and filters to reorder")).toBeVisible();
    await expect(panel(page).locator("[data-grip]")).toHaveCount(0);
    await panel(page).getByRole("button", { name: "Actions for one" }).click();
    await expect(page.getByRole("menuitem", { name: "Move up" })).toBeDisabled();
    await page.keyboard.press("Escape");
    // The order is in the manifest.
    await panel(page).getByRole("button", { name: "All" }).click();
    expect((await manifestOf(page)).references.map((r: { title: string }) => r.title)).toEqual([
      "three",
      "one",
      "two",
    ]);
  });

  test("sorts the list as a view and allows reordering only in manual order", async ({ page }) => {
    await withReferences(page, {
      "/refs/zebra.png": PIXEL,
      "/refs/apple.png": PIXEL.slice(0, 60).concat([1]),
      "/refs/notes.md": bytes("# notes"),
    });
    const titles = () =>
      panel(page)
        .getByRole("listitem")
        .evaluateAll((li) => li.map((x) => x.querySelector("[data-title]")!.textContent));
    await expect(panel(page).getByText("3 references")).toBeVisible();
    await expect(panel(page).locator("[data-grip]")).toHaveCount(3);
    await panel(page).getByRole("button", { name: "Sort references" }).click();
    await page.getByRole("menuitemradio", { name: "Title A-Z" }).click();
    await expect.poll(titles).toEqual(["apple", "notes", "zebra"]);
    await expect(panel(page).getByText("Switch to Manual order to reorder")).toBeVisible();
    await expect(panel(page).locator("[data-grip]")).toHaveCount(0);
    await panel(page).getByRole("button", { name: "Sort references" }).click();
    await page.getByRole("menuitemradio", { name: "Title Z-A" }).click();
    await expect.poll(titles).toEqual(["zebra", "notes", "apple"]);
    await panel(page).getByRole("button", { name: "Sort references" }).click();
    await page.getByRole("menuitemradio", { name: "Kind" }).click();
    await expect.poll(titles).toEqual(["apple", "zebra", "notes"]); // images first, each kind by title
    await panel(page).getByRole("button", { name: "Sort references" }).click();
    await page.getByRole("menuitemradio", { name: "Newest first" }).click();
    await expect.poll(titles).toHaveLength(3);
    await panel(page).getByRole("button", { name: "Sort references" }).click();
    await page.getByRole("menuitemradio", { name: "Oldest first" }).click();
    await expect.poll(titles).toHaveLength(3);
    await panel(page).getByRole("button", { name: "Sort references" }).click();
    await page.getByRole("menuitemradio", { name: "Manual order" }).click();
    await expect.poll(titles).toEqual(["zebra", "apple", "notes"]);
    await expect(panel(page).locator("[data-grip]")).toHaveCount(3);
    // The saved order was never changed by sorting.
    expect((await manifestOf(page)).references.map((r: { title: string }) => r.title)).toEqual([
      "zebra",
      "apple",
      "notes",
    ]);
  });

  test("a removed reference can be restored from the removed list", async ({ page }) => {
    await withReferences(page, { "/refs/one.png": PIXEL });
    await expect(panel(page).getByRole("button", { name: /Removed references/ })).toHaveCount(0);
    await panel(page).getByRole("button", { name: "Actions for one" }).click();
    await page.getByRole("menuitem", { name: "Remove from book" }).click();
    await expect(panel(page).getByRole("listitem")).toHaveCount(0);
    await panel(page).getByRole("button", { name: "Removed references (1)" }).click();
    const dialog = page.getByRole("dialog", { name: "Removed references" });
    await expect(dialog.getByText("one.png")).toBeVisible();
    await expect(dialog.getByText(/Image · Removed/)).toBeVisible();
    await dialog.getByRole("button", { name: "Restore one" }).click();
    await expect(dialog.getByText("Nothing removed")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(panel(page).getByRole("listitem")).toHaveCount(1);
    await expect(panel(page).getByRole("button", { name: /Removed references/ })).toHaveCount(0);
    expect((await manifestOf(page)).references.map((r: { file: string }) => r.file)).toEqual([
      "references/one.png",
    ]);
  });

  test("a restore that fails says so under its row and can be retried", async ({ page }) => {
    await withReferences(page, { "/refs/one.png": PIXEL });
    await panel(page).getByRole("button", { name: "Actions for one" }).click();
    await page.getByRole("menuitem", { name: "Remove from book" }).click();
    await panel(page).getByRole("button", { name: "Removed references (1)" }).click();
    const dialog = page.getByRole("dialog", { name: "Removed references" });
    await page.evaluate(() => (window.__restoreFails = true));
    await dialog.getByRole("button", { name: "Restore one" }).click();
    await expect(dialog.getByRole("alert")).toContainText("Could not restore one");
    await page.evaluate(() => (window.__restoreFails = false));
    await dialog.getByRole("button", { name: "Restore one" }).click();
    await expect(dialog.getByText("Nothing removed")).toBeVisible();
  });

  test("removes a reference from its row menu", async ({ page }) => {
    await withReferences(page, { "/refs/one.png": PIXEL });
    await panel(page).getByRole("button", { name: "Actions for one" }).click();
    await page.getByRole("menuitem", { name: "Open" }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.keyboard.press("Escape");
    await panel(page).getByRole("button", { name: "Actions for one" }).click();
    await page.getByRole("menuitem", { name: "Remove from book" }).click();
    await expect(panel(page).getByRole("listitem")).toHaveCount(0);
  });

  test("on a tablet the library is a side drawer that closes with its button", async ({ page }) => {
    await page.setViewportSize({ width: 820, height: 1180 });
    await withReferences(page, { "/refs/one.png": PIXEL });
    const drawer = page.getByRole("dialog", { name: "References" });
    await expect(drawer).toBeVisible();
    const box = (await drawer.boundingBox())!;
    expect(box.width).toBeLessThan(500);
    expect(box.x + box.width).toBeGreaterThan(800);
    await expect(drawer.getByRole("button", { name: "Add files" })).toBeVisible();
    await drawer.getByRole("button", { name: "Close references" }).click();
    await expect(drawer).toBeHidden();
  });

  test("on a phone the library opens as a dialog and a reference opens its viewer", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await newProject(page);
    await page.evaluate(() => (window.__pickedRefs = ["/refs/notes.md"]));
    await page.getByRole("button", { name: "References", exact: true }).click();
    const sheet = page.getByRole("dialog", { name: "References" });
    await sheet.getByRole("button", { name: "Add files" }).click();
    await sheet.getByRole("button", { name: "notes", exact: true }).click();
    await expect(page.getByRole("dialog", { name: "notes" })).toBeVisible();
    await expect(page.getByRole("dialog", { name: "References" })).toHaveCount(0);
  });
});
