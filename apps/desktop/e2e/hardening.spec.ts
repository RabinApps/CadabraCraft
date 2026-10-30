import { expect, test, type Page } from "./support/coverage";
import { fakeTauri } from "./support/fakeTauri";
import { newProject } from "./support/helpers";

test.beforeEach(async ({ page }) => {
  await fakeTauri(page);
});

test.describe("hardening: paste, find and export failures", () => {
  const ed = (page: Page) => page.locator(".ProseMirror");
  const dlg = (page: Page) => page.getByRole("dialog", { name: "Paste as styled text?" });
  const bar = (page: Page) => page.getByRole("search", { name: "Find and replace" });
  async function paste(page: Page, text: string) {
    await page.evaluate((t) => {
      const dt = new DataTransfer();
      dt.setData("text/plain", t);
      document
        .querySelector(".ProseMirror")!
        .dispatchEvent(
          new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }),
        );
    }, text);
  }
  async function ready(page: Page) {
    await newProject(page);
    await page.locator(".ProseMirror p").last().click();
    await page.keyboard.type("Q");
    await page.keyboard.press("Backspace");
  }
  const menu = async (page: Page, id: string) => {
    await page.waitForFunction(() => Boolean(window.__cadabraMenu));
    return page.evaluate((i) => window.__cadabraMenu.run(i) as boolean, id);
  };

  test("pasting text the converter refuses (thousands of nested divs) pastes as text with a notice and the editor keeps working", async ({
    page,
  }) => {
    await ready(page);
    await paste(page, "<div>".repeat(3000));
    await expect(dlg(page)).toHaveCount(0);
    await expect(
      page.getByRole("status").filter({ hasText: "Could not convert the HTML" }),
    ).toBeVisible();
    await expect(ed(page)).toContainText("<div><div>");
    await page.keyboard.type("still typing");
    await expect(ed(page)).toContainText("still typing");
  });

  test("a multi-megabyte paste is left to the normal paste without opening the dialog", async ({
    page,
  }) => {
    await ready(page);
    await paste(page, `<p>x</p> ${"word ".repeat(250_000)}`);
    await expect(dlg(page)).toHaveCount(0);
  });

  test("a second paste while the dialog is open is ignored", async ({ page }) => {
    await ready(page);
    await paste(page, "<p>First <b>one</b></p>");
    await expect(dlg(page)).toBeVisible();
    await paste(page, "<p>Second <i>one</i></p>");
    await expect(dlg(page)).toHaveCount(1);
    await expect(dlg(page).getByTestId("paste-source")).toHaveText("<p>First <b>one</b></p>");
    await dlg(page).getByRole("button", { name: "Convert" }).click();
    await expect(ed(page)).toContainText("First one");
    await expect(ed(page)).not.toContainText("Second");
  });

  test("converted blocks pasted into a heading and a table cell stay valid", async ({ page }) => {
    await ready(page);
    const h1 = page.locator(".ProseMirror h1");
    const box = await h1.boundingBox();
    // The right end of the title's line: End scrolls instead of moving the caret on macOS.
    await h1.click({ position: { x: box!.width - 2, y: box!.height / 2 } });
    // A real key makes ProseMirror read the click's selection before the synthetic paste.
    await page.keyboard.type("Q");
    await page.keyboard.press("Backspace");
    await expect(page.locator(".ProseMirror h1")).toHaveText("Chapter One");
    await paste(page, "<h2>Extra</h2><p>Body</p>");
    await dlg(page).getByRole("button", { name: "Convert" }).click();
    await expect(page.locator(".ProseMirror h1")).toHaveText("Chapter OneExtra Body");
    await page.locator(".ProseMirror p").last().click();
    expect(await menu(page, "editor.table")).toBe(true);
    await page
      .getByRole("dialog", { name: "Insert table" })
      .getByRole("button", { name: "Insert" })
      .click();
    await expect(ed(page).locator("td").first()).toBeVisible();
    await ed(page).locator("td").first().click();
    await page.keyboard.type("Q");
    await page.keyboard.press("Backspace");
    await paste(page, "<h2>Cell</h2><ul><li>one</li></ul>");
    await dlg(page).getByRole("button", { name: "Convert" }).click();
    await expect(ed(page).locator("td h2, td ul")).toHaveCount(0);
    await expect(ed(page).locator("td").first()).toContainText("Cell");
  });

  test("replacing across the book stops cleanly when a page cannot be written, and changes nothing", async ({
    page,
  }) => {
    await newProject(page);
    const typeInPage = async (text: string) => {
      await ed(page).click();
      await page.keyboard.press("ControlOrMeta+End");
      await page.keyboard.type(text);
    };
    await typeInPage(" owl one");
    await page.getByRole("button", { name: "Add chapter", exact: true }).click();
    await expect(ed(page).locator("h1")).toHaveText("Chapter 2");
    await typeInPage("owl two");
    await page.getByRole("button", { name: "Chapter One", exact: true }).click();
    await expect(ed(page)).toContainText("owl one");
    await page.keyboard.press("ControlOrMeta+f");
    await page.keyboard.type("owl");
    await bar(page).getByRole("button", { name: "All chapters" }).click();
    await bar(page).getByLabel("Replace with").fill("hen");
    await page.evaluate(() => {
      window.__failWrite = (p: string) => p.includes("002-");
    });
    await bar(page).getByRole("button", { name: "Replace all" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Replace all stopped" })).toContainText(
      "No space left on device",
    );
    await expect(page.getByRole("status")).toContainText("Nothing was changed");
    const disk = await page.evaluate(() => window.__disk as Record<string, string>);
    expect(disk["manuscript/001-chapter-one.json"]).toContain("owl one");
    expect(disk["manuscript/001-chapter-one.json"]).not.toContain("hen");
    expect(disk["manuscript/002-chapter-2.json"]).toContain("owl two");
  });

  test("Enter while composing text (IME) does not step or replace", async ({ page }) => {
    await newProject(page);
    await ed(page).click();
    await page.keyboard.type(" owl owl");
    await page.keyboard.press("ControlOrMeta+f");
    await page.keyboard.type("owl");
    await expect(bar(page).getByText("1 of 2")).toBeVisible();
    await bar(page)
      .getByLabel("Find", { exact: true })
      .dispatchEvent("keydown", { key: "Enter", isComposing: true, keyCode: 229, bubbles: true });
    await expect(bar(page).getByText("1 of 2")).toBeVisible();
    await bar(page).getByLabel("Find", { exact: true }).press("Enter");
    await expect(bar(page).getByText("2 of 2")).toBeVisible();
  });

  test("Export Markdown: a write failure shows the reason, keeps the dialog usable and shows no success", async ({
    page,
  }) => {
    await newProject(page);
    await page.evaluate(() => {
      window.__failBytes = true;
    });
    await page.getByRole("button", { name: "Export", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Export book" });
    await dialog.getByRole("radio", { name: "Markdown" }).click();
    await dialog.getByRole("button", { name: "Export", exact: true }).click();
    await expect(dialog.getByRole("alert")).toContainText("No space left on device");
    await expect(dialog.getByRole("button", { name: "Export", exact: true })).toBeEnabled();
    await expect(page.getByRole("status").filter({ hasText: "Exported" })).toHaveCount(0);
    await page.evaluate(() => {
      window.__failBytes = false;
    });
    await dialog.getByRole("button", { name: "Export", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByRole("status")).toHaveText("Exported exports/en/book.md");
  });

  test("Export Markdown: an unreadable chapter file is named in the error", async ({ page }) => {
    await newProject(page);
    await page.evaluate(() => {
      window.__disk["manuscript/001-chapter-one.json"] = "{ not json";
    });
    await page.getByRole("button", { name: "Export", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Export book" });
    await dialog.getByRole("radio", { name: "Markdown" }).click();
    await dialog.getByRole("button", { name: "Export", exact: true }).click();
    await expect(dialog.getByRole("alert")).toContainText("manuscript/001-chapter-one.json");
  });
});

test.describe("hardening: the file watcher", () => {
  test("a watcher failure shows a notice and editing keeps working", async ({ page }) => {
    await newProject(page);
    await page.evaluate(() => window.__emit!("project-watch-error", "watch_failed"));
    await expect(
      page
        .getByRole("status")
        .filter({ hasText: "Changes made outside the app may not be noticed" }),
    ).toBeVisible();
    await page.locator(".ProseMirror p").last().click();
    await page.keyboard.type("still typing");
    await expect(page.locator(".ProseMirror")).toContainText("still typing");
  });
});

/** Seeds an earlier version of the first chapter as a snapshot and returns its path. */
