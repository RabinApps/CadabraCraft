import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { By, until } from "selenium-webdriver";
import { describe, expect, it } from "vitest";
import { click, eventually, stubDialogs, useEnglish } from "./driver";
import { skip, useApp } from "./session";

// Import without a native dialog: the two picker answers (source file, target folder) are queued through the dev bridge.
describe.skipIf(skip)("native Markdown import", () => {
  const app = useApp();

  it("imports a Markdown file into a new book and leaves the source untouched", async () => {
    const { driver } = app.session();
    const src = join(app.dir(), "src");
    mkdirSync(src);
    const source = join(src, "book.md");
    const text = "# First\n\nFirst chapter text.\n\n# Second\n\nSecond chapter text.\n";
    writeFileSync(source, text);
    const target = join(app.dir(), "imported");

    await useEnglish(driver);
    await stubDialogs(driver, [source, target]);
    await click(driver, "Import…");
    await click(driver, "Choose file…");
    await click(driver, "Choose…");
    await click(driver, "Next");
    await click(driver, "Import");
    await driver.wait(
      until.elementLocated(By.xpath("//*[@role='dialog'][contains(.,'Imported 2 chapters')]")),
      30_000,
    );

    const chapters = await eventually(() => {
      try {
        const d = join(target, "manuscript");
        const files = readdirSync(d);
        return files.length === 2 && files.map((n) => readFileSync(join(d, n), "utf8"));
      } catch {
        return false;
      }
    });
    expect(chapters[0]).toContain("First chapter text.");
    expect(chapters[1]).toContain("Second chapter text.");
    expect(readFileSync(source, "utf8")).toBe(text);
  });
});
