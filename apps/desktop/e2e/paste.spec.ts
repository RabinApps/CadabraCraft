import { expect, test, type Page } from "@playwright/test";
import { fakeTauri } from "./support/fakeTauri";
import { newProject } from "./support/helpers";

test.beforeEach(async ({ page }) => {
  await fakeTauri(page);
});

test.describe("pasting HTML text", () => {
  const HTML = "<p>The gate was <b>old</b></p>";
  const dlg = (page: Page) => page.getByRole("dialog", { name: "Paste as styled text?" });
  /** A paste event the way a code editor sends it: text/plain only, unless `html` is given too. */
  async function paste(page: Page, text: string, html?: string) {
    await page.evaluate(([t, h]) => {
      const dt = new DataTransfer();
      dt.setData("text/plain", t!);
      if (h) dt.setData("text/html", h);
      document.querySelector(".ProseMirror")!.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
    }, [text, html ?? ""]);
  }
  /** Caret in the empty paragraph under the chapter title. */
  const toEnd = async (page: Page) => {
    await page.locator(".ProseMirror p").last().click();
    // A real key makes ProseMirror read the click's selection before the synthetic paste.
    await page.keyboard.type("Q");
    await page.keyboard.press("Backspace");
  };
  async function ready(page: Page) {
    await newProject(page);
    await toEnd(page);
  }
  const convertCommand = (page: Page) => page.evaluate(async () => { (await import("/src/app/commands.ts" as string)).runCommand("edit.convertHtml"); });

  test("asks, converts to styled text, and one Undo restores", async ({ page }) => {
    await ready(page);
    await paste(page, HTML);
    await expect(dlg(page)).toBeVisible();
    await expect(dlg(page).getByTestId("paste-source")).toHaveText(HTML);
    await expect(dlg(page).getByTestId("paste-result")).toHaveText("The gate was old");
    await dlg(page).getByRole("button", { name: "Convert" }).click();
    await expect(dlg(page)).toHaveCount(0);
    await expect(page.locator(".ProseMirror p").last()).toHaveText("The gate was old");
    await expect(page.locator(".ProseMirror p strong").last()).toHaveText("old");
    await expect(page.locator(".ProseMirror")).toBeFocused();
    await page.keyboard.press("ControlOrMeta+z");
    await expect(page.locator(".ProseMirror")).not.toContainText("The gate was");
    await expect(page.locator(".ProseMirror strong")).toHaveCount(0);
  });

  test("Keep as text inserts the tags literally", async ({ page }) => {
    await ready(page);
    await paste(page, HTML);
    await dlg(page).getByRole("button", { name: "Keep as text" }).click();
    await expect(page.locator(".ProseMirror p").last()).toHaveText(HTML);
    await expect(page.locator(".ProseMirror strong")).toHaveCount(0);
    await expect(page.locator(".ProseMirror")).toBeFocused();
  });

  test("Escape closes without inserting and returns focus to the editor", async ({ page }) => {
    await ready(page);
    await paste(page, HTML);
    await page.keyboard.press("Escape");
    await expect(dlg(page)).toHaveCount(0);
    await expect(page.locator(".ProseMirror")).not.toContainText("The gate");
    await expect(page.locator(".ProseMirror")).toBeFocused();
  });

  test("Remember my choice converts the next paste without asking and shows in Settings", async ({ page }) => {
    await ready(page);
    await paste(page, HTML);
    await dlg(page).getByLabel("Remember my choice").check();
    await dlg(page).getByRole("button", { name: "Convert" }).click();
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem("cadabracraft.settings") ?? "{}").rawHtmlPaste)).toBe("convert");
    await page.keyboard.press("Enter");
    await paste(page, "<p>Second <i>one</i></p>");
    await expect(dlg(page)).toHaveCount(0);
    await expect(page.locator(".ProseMirror em")).toHaveText("one");
    await page.getByRole("button", { name: "Settings" }).click();
    await expect(page.getByRole("combobox", { name: "When pasting HTML" })).toHaveValue("convert");
  });

  test("Settings can keep HTML as text, which pastes the default way", async ({ page }) => {
    await ready(page);
    await page.getByRole("button", { name: "Settings" }).click();
    await page.getByRole("combobox", { name: "When pasting HTML" }).selectOption("text");
    await page.getByRole("button", { name: "Back", exact: true }).click();
    await toEnd(page);
    await paste(page, HTML);
    await expect(dlg(page)).toHaveCount(0);
  });

  test("a clipboard with real text/html keeps the normal paste", async ({ page }) => {
    await ready(page);
    await paste(page, HTML, "<p>The gate was <b>old</b></p>");
    await expect(dlg(page)).toHaveCount(0);
  });

  test("plain text with a stray < is not offered for conversion", async ({ page }) => {
    await ready(page);
    await paste(page, "if a < b and c > d");
    await expect(dlg(page)).toHaveCount(0);
  });

  test("inside a code block it pastes as-is", async ({ page }) => {
    await ready(page);
    await page.keyboard.type("``` ");
    await expect(page.locator(".ProseMirror pre")).toBeVisible();
    await paste(page, HTML);
    await expect(dlg(page)).toHaveCount(0);
  });

  test("Convert HTML in Selection replaces the selected tags, and says so when there are none", async ({ page }) => {
    await ready(page);
    // Select the last paragraph's text explicitly (Shift+Home depends on where the caret landed), then let ProseMirror read the selection
    const selectLastParagraph = async (text: string) => {
      await page.evaluate(() => {
        const p = [...document.querySelectorAll(".ProseMirror p")].pop()!;
        const r = document.createRange();
        r.selectNodeContents(p);
        const sel = getSelection()!;
        sel.removeAllRanges();
        sel.addRange(r);
      });
      await expect.poll(() => page.evaluate(() => getSelection()?.toString())).toBe(text);
      await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    };
    await page.keyboard.type("<u>mark</u>");
    await selectLastParagraph("<u>mark</u>");
    // under load ProseMirror can still hold the previous selection when the command runs; select again and retry until it converts
    await expect(async () => {
      await selectLastParagraph("<u>mark</u>");
      await convertCommand(page);
      await expect(page.locator(".ProseMirror u")).toHaveText("mark", { timeout: 1000 });
    }).toPass({ timeout: 10000 });
    await selectLastParagraph("mark");
    await convertCommand(page);
    await expect(page.getByRole("status").filter({ hasText: "No HTML found in the selection" })).toBeVisible();
  });

  test("the dialog fits a phone", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await ready(page);
    await paste(page, `<p>${"long word ".repeat(40)}<b>end</b></p>`);
    await expect(dlg(page)).toBeVisible();
    const box = await dlg(page).boundingBox();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(390);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await expect(dlg(page).getByRole("button", { name: "Convert" })).toBeVisible();
  });
});
