import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { WebDriver } from "selenium-webdriver";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { click, createBook, nativeSupport, startSession, useEnglish, type Session } from "./driver";

// axe-core run inside the real webview (WebView2 on Windows, WebKitGTK on Linux) through tauri-driver, so a rule that
// only fails in the system webview shows up here. NOT RUN: this Mac cannot host tauri-driver (see nativeSupport), and
// no spec in this directory has run against a real driver yet. The Playwright specs scan the same screens in Chromium
// and WebKit.
const skip = nativeSupport();
if (skip) console.warn(`[native e2e] skipped: ${skip}`);

// WCAG 2.0 to 2.2 A and AA, as in e2e/a11y.spec.ts.
const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

// axe-core is installed with @axe-core/playwright; resolve it from there instead of adding a dependency.
const axeSource = () =>
  readFileSync(
    createRequire(createRequire(import.meta.url).resolve("@axe-core/playwright")).resolve(
      "axe-core/axe.min.js",
    ),
    "utf8",
  );

async function scan(driver: WebDriver, source: string): Promise<string[]> {
  await driver.executeScript(source);
  const found = await driver.executeAsyncScript<{ id: string; nodes: { target: string[] }[] }[]>(
    `const done = arguments[arguments.length - 1];
     Promise.all(document.getAnimations().map((a) => a.finished.catch(() => {})))
       .then(() => axe.run(document, { runOnly: { type: "tag", values: ${JSON.stringify(TAGS)} } }))
       .then((r) => done(r.violations.map((v) => ({ id: v.id, nodes: v.nodes.map((n) => ({ target: n.target })) }))));`,
  );
  return found.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`);
}

describe.skipIf(skip)("axe in the system webview", () => {
  let session: Session;
  let root: string;
  beforeAll(async () => {
    root = mkdtempSync(join(tmpdir(), "cadabracraft-native-"));
    session = await startSession();
  });
  afterAll(async () => {
    await session?.stop();
    if (root) rmSync(root, { recursive: true, force: true });
  });

  it("finds no WCAG A/AA violations on Home, a dialog and the editor", async () => {
    const { driver } = session;
    const source = axeSource();
    await useEnglish(driver);
    expect(await scan(driver, source), "Home").toEqual([]);

    await click(driver, "New project");
    expect(await scan(driver, source), "New book dialog").toEqual([]);
    await driver.actions().sendKeys("").perform(); // Escape

    await createBook(driver, root, "Axe Book", "Tester");
    expect(await scan(driver, source), "Editor").toEqual([]);
  });
});
