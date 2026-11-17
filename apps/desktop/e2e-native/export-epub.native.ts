import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { By, until } from "selenium-webdriver";
import { describe, expect, it } from "vitest";
import { click, createBook, eventually, typeInEditor } from "./driver";
import { skip, useApp } from "./session";

// The EPUB is built in the webview and written by Rust under exports/<language>/.
describe.skipIf(skip)("native EPUB export", () => {
  const app = useApp();

  it("writes a real EPUB file", async () => {
    const { driver } = app.session();
    const root = join(app.dir(), "book");
    await createBook(driver, root, "Export Book", "Tester");
    await typeInEditor(driver, "Exported sentence");

    await click(driver, "Export");
    const dialog = await driver.wait(until.elementLocated(By.css('[role="dialog"]')), 10_000);
    await dialog
      .findElement(By.xpath(".//*[self::button or @role='radio'][normalize-space(.)='EPUB 3']"))
      .click();
    await dialog.findElement(By.css('button[type="submit"]')).click();

    const epub = join(root, "exports", "en", "book.epub");
    await eventually(() => {
      try {
        return statSync(epub).size > 0;
      } catch {
        return false;
      }
    }, 60_000);
    const bytes = readFileSync(epub);
    expect(bytes.subarray(0, 2).toString("latin1")).toBe("PK"); // a zip container
    expect(bytes.includes("application/epub+zip")).toBe(true); // the stored mimetype entry
  });
});
