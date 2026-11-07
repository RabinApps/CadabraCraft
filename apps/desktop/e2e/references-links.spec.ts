import { expect, test, type Page } from "./support/coverage";
import { fakeTauri } from "./support/fakeTauri";
import { addReference, manifestOf, newProject } from "./support/helpers";

test.beforeEach(async ({ page }) => {
  await fakeTauri(page);
});

const panel = (page: Page) => page.getByRole("region", { name: "References" });
const titles = (page: Page) =>
  panel(page)
    .getByRole("listitem")
    .evaluateAll((li) => li.map((x) => x.querySelector("[data-title]")!.textContent));

async function openPanel(page: Page) {
  await newProject(page);
  await page.getByRole("button", { name: "References", exact: true }).first().click();
}

async function addLink(page: Page, url: string, title?: string) {
  await addReference(panel(page), "Add link");
  const dialog = page.getByRole("dialog", { name: "Add link" });
  await dialog.getByLabel("Address").fill(url);
  if (title) await dialog.getByLabel("Title (optional)").fill(title);
  await dialog.getByRole("button", { name: "Add link" }).click();
  return dialog;
}

async function addNote(page: Page, text: string, title?: string) {
  await addReference(panel(page), "Add note");
  const dialog = page.getByRole("dialog", { name: "Add note" });
  if (title) await dialog.getByLabel("Title (optional)").fill(title);
  await dialog.getByLabel("Note", { exact: true }).fill(text);
  await dialog.getByRole("button", { name: "Add note" }).click();
  return dialog;
}

test.describe("link and note references", () => {
  test("the Add menu offers files, link and note", async ({ page }) => {
    await openPanel(page);
    await panel(page).getByRole("button", { name: "Add", exact: true }).click();
    await expect(page.getByRole("menuitem")).toHaveText(["Add files", "Add link", "Add note"]);
    await page.keyboard.press("Escape");
    await expect(page.getByRole("menuitem")).toHaveCount(0);
  });

  test("adds a link, titled by its host, and keeps it in the manifest", async ({ page }) => {
    await openPanel(page);
    const dialog = await addLink(page, "  https://www.Saltmarsh.example.org/guide ");
    await expect(dialog).toBeHidden();
    const row = panel(page).getByRole("listitem").first();
    await expect(row.locator("[data-title]")).toHaveText("saltmarsh.example.org");
    await expect(row).toContainText("Link · saltmarsh.example.org");
    expect((await manifestOf(page)).references).toEqual([
      expect.objectContaining({
        id: "ref-1",
        kind: "link",
        url: "https://www.saltmarsh.example.org/guide",
        title: "saltmarsh.example.org",
      }),
    ]);
    // The focus goes back to the menu button that led to the dialog.
    await expect(panel(page).getByRole("button", { name: "Add", exact: true })).toBeFocused();
  });

  test("uses the title given, and refuses a bad or repeated address in the dialog", async ({
    page,
  }) => {
    await openPanel(page);
    await addReference(panel(page), "Add link");
    const dialog = page.getByRole("dialog", { name: "Add link" });
    for (const bad of ["javascript:alert(1)", "example.org", "file:///etc/passwd"]) {
      await dialog.getByLabel("Address").fill(bad);
      await dialog.getByRole("button", { name: "Add link" }).click();
      await expect(
        dialog.getByText("Enter an address that starts with http:// or https://."),
      ).toBeVisible();
      await expect(dialog.getByLabel("Address")).toBeFocused();
      await expect(dialog.getByLabel("Address")).toHaveAttribute("aria-invalid", "true");
    }
    await dialog.getByLabel("Address").fill("https://a.example.org/");
    await expect(dialog.getByText("Enter an address")).toHaveCount(0);
    await dialog.getByLabel("Title (optional)").fill("Field guide");
    await dialog.getByRole("button", { name: "Add link" }).click();
    await expect(dialog).toBeHidden();
    await expect.poll(() => titles(page)).toEqual(["Field guide"]);
    await addLink(page, "https://a.example.org");
    await expect(
      page
        .getByRole("dialog", { name: "Add link" })
        .getByText("This address is already in this book."),
    ).toBeVisible();
    await page
      .getByRole("dialog", { name: "Add link" })
      .getByRole("button", { name: "Cancel" })
      .click();
    await expect.poll(() => titles(page)).toEqual(["Field guide"]);
    // A cancelled dialog starts empty the next time.
    await addReference(panel(page), "Add link");
    await expect(page.getByRole("dialog", { name: "Add link" }).getByLabel("Address")).toHaveValue(
      "",
    );
  });

  test("opens a link in the browser from the viewer and from the row menu, and says when it cannot", async ({
    page,
  }) => {
    await openPanel(page);
    await addLink(page, "https://a.example.org/x", "Guide");
    await panel(page).getByRole("button", { name: "Actions for Guide" }).click();
    await page.getByRole("menuitem", { name: "Open in browser" }).click();
    expect(await page.evaluate(() => window.__opened)).toEqual(["url:https://a.example.org/x"]);
    await panel(page)
      .getByRole("button", { name: /^Guide/ })
      .first()
      .click();
    const viewer = page.getByRole("dialog");
    await expect(viewer.getByLabel("Address")).toHaveValue("https://a.example.org/x");
    await viewer.getByRole("button", { name: "Open in browser" }).first().click();
    expect(await page.evaluate(() => window.__opened)).toEqual([
      "url:https://a.example.org/x",
      "url:https://a.example.org/x",
    ]);
    await page.evaluate(() => {
      window.__refErrors = { open: { kind: "io", message: "no browser" } };
    });
    await viewer.getByRole("button", { name: "Open in browser" }).first().click();
    await expect(viewer.getByRole("alert")).toBeVisible();
  });

  test("edits a link's address in the viewer and refuses a bad one", async ({ page }) => {
    await openPanel(page);
    await addLink(page, "https://a.example.org/", "Guide");
    await panel(page)
      .getByRole("button", { name: /^Guide/ })
      .first()
      .click();
    const viewer = page.getByRole("dialog");
    const address = viewer.getByLabel("Address");
    await address.fill("ftp://nope");
    await address.blur();
    await expect(
      viewer.getByText("Enter an address that starts with http:// or https://."),
    ).toBeVisible();
    expect((await manifestOf(page)).references[0].url).toBe("https://a.example.org/");
    await address.fill("https://b.example.org/new");
    await address.blur();
    await expect
      .poll(async () => (await manifestOf(page)).references[0].url)
      .toBe("https://b.example.org/new");
    await expect(viewer.getByText("Enter an address")).toHaveCount(0);
  });

  test("copies a link's address", async ({ page, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]).catch(() => {});
    await openPanel(page);
    await addLink(page, "https://a.example.org/", "Guide");
    await panel(page)
      .getByRole("button", { name: /^Guide/ })
      .first()
      .click();
    await page.getByRole("dialog").getByRole("button", { name: "Copy address" }).click();
    await expect(page.getByRole("dialog").getByRole("status")).toBeVisible();
  });

  test("adds a note, titled by its first line, and edits its text in the viewer", async ({
    page,
  }) => {
    await openPanel(page);
    const dialog = await addNote(
      page,
      "The wall is older than the gate.\nNobody picks fruit early.",
    );
    await expect(dialog).toBeHidden();
    const row = panel(page).getByRole("listitem").first();
    await expect(row.locator("[data-title]")).toHaveText("The wall is older than the gate.");
    await expect(row).toContainText("Note · The wall is older than the gate.");
    await row.getByRole("button", { name: /^The wall/ }).click();
    const viewer = page.getByRole("dialog");
    const text = viewer.getByLabel("Note", { exact: true });
    await expect(text).toHaveValue("The wall is older than the gate.\nNobody picks fruit early.");
    await text.fill("Rewritten.");
    await text.blur();
    await expect.poll(async () => (await manifestOf(page)).references[0].text).toBe("Rewritten.");
    // The author's own comment is a separate field.
    await viewer.getByLabel("Comment").fill("Check with Ines");
    await viewer.getByLabel("Comment").blur();
    await expect
      .poll(async () => (await manifestOf(page)).references[0].note)
      .toBe("Check with Ines");
  });

  test("a note needs some text, and uses the title given", async ({ page }) => {
    await openPanel(page);
    await addReference(panel(page), "Add note");
    const dialog = page.getByRole("dialog", { name: "Add note" });
    await dialog.getByRole("button", { name: "Add note" }).click();
    await expect(dialog.getByText("Write something in the note first.")).toBeVisible();
    await expect(dialog.getByLabel("Note", { exact: true })).toBeFocused();
    await dialog.getByLabel("Title (optional)").fill("Orchard rules");
    await dialog.getByLabel("Note", { exact: true }).fill("No fruit before frost.");
    await dialog.getByRole("button", { name: "Add note" }).click();
    await expect(dialog).toBeHidden();
    await expect.poll(() => titles(page)).toEqual(["Orchard rules"]);
  });

  test("filters by Links and Notes and searches their address and text", async ({ page }) => {
    await openPanel(page);
    await addLink(page, "https://saltmarsh.example.org/", "Marsh guide");
    await addNote(page, "Gulls nest by the pier", "Birds");
    await panel(page).getByRole("button", { name: "Links", exact: true }).click();
    await expect.poll(() => titles(page)).toEqual(["Marsh guide"]);
    await panel(page).getByRole("button", { name: "Notes", exact: true }).click();
    await expect.poll(() => titles(page)).toEqual(["Birds"]);
    await panel(page).getByRole("button", { name: "All", exact: true }).click();
    await panel(page).getByRole("searchbox").fill("saltmarsh");
    await expect.poll(() => titles(page)).toEqual(["Marsh guide"]);
    await panel(page).getByRole("searchbox").fill("pier");
    await expect.poll(() => titles(page)).toEqual(["Birds"]);
  });

  test("removes a link without touching files or the removed list", async ({ page }) => {
    await openPanel(page);
    await addLink(page, "https://a.example.org/", "Guide");
    await addNote(page, "Body", "Keep");
    await panel(page).getByRole("button", { name: "Actions for Guide" }).click();
    await page.getByRole("menuitem", { name: "Remove from book" }).click();
    await expect.poll(() => titles(page)).toEqual(["Keep"]);
    expect(
      await page.evaluate(() =>
        Object.keys(window.__disk).filter((k) => k.includes(".cadabra/trash/")),
      ),
    ).toEqual([]);
    await expect(panel(page).getByRole("button", { name: /Removed references/ })).toHaveCount(0);
  });

  test("links a note to a chapter like any other reference", async ({ page }) => {
    await openPanel(page);
    await addNote(page, "Body", "Keep");
    await panel(page).getByRole("button", { name: /^Keep/ }).first().click();
    const viewer = page.getByRole("dialog");
    await viewer.getByLabel("Link to a chapter").selectOption({ label: "Chapter One" });
    await expect.poll(async () => (await manifestOf(page)).references[0].chapters).toHaveLength(1);
    await expect(viewer.getByText("Chapter One").first()).toBeVisible();
  });

  test("mixed kinds reorder with the row menu and by dragging; Escape cancels a drag", async ({
    page,
  }) => {
    await openPanel(page);
    await addLink(page, "https://a.example.org/", "Link A");
    await addNote(page, "n", "Note B");
    await addLink(page, "https://c.example.org/", "Link C");
    await expect.poll(() => titles(page)).toEqual(["Link A", "Note B", "Link C"]);
    await panel(page).getByRole("button", { name: "Actions for Note B" }).click();
    await page.getByRole("menuitem", { name: "Move up" }).click();
    await expect.poll(() => titles(page)).toEqual(["Note B", "Link A", "Link C"]);
    const grip = panel(page).locator("[data-grip]").first();
    const last = panel(page).getByRole("listitem").last();
    const g = (await grip.boundingBox())!;
    const l = (await last.boundingBox())!;
    // Escape during a drag drops nothing.
    await page.mouse.move(g.x + g.width / 2, g.y + g.height / 2);
    await page.mouse.down();
    await page.mouse.move(g.x + 4, l.y + l.height + 4, { steps: 5 });
    await expect(panel(page).locator("[data-drop-line]")).toHaveCount(1);
    await page.keyboard.press("Escape");
    await expect(panel(page).locator("[data-drop-line]")).toHaveCount(0);
    await page.mouse.up();
    await expect.poll(() => titles(page)).toEqual(["Note B", "Link A", "Link C"]);
    // Letting go below the last row moves the row there.
    await page.mouse.move(g.x + g.width / 2, g.y + g.height / 2);
    await page.mouse.down();
    await page.mouse.move(g.x + 4, l.y + l.height + 4, { steps: 5 });
    await page.mouse.up();
    await expect.poll(() => titles(page)).toEqual(["Link A", "Link C", "Note B"]);
    expect((await manifestOf(page)).references.map((r: { kind: string }) => r.kind)).toEqual([
      "link",
      "link",
      "note",
    ]);
  });
});
