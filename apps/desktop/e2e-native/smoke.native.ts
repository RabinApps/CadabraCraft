import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { By, until } from "selenium-webdriver";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  click,
  labelled,
  nativeSupport,
  startSession,
  stubFolderDialog,
  typeInEditor,
  useEnglish,
  type Session,
} from "./driver";

// Runs the real Tauri binary (real Rust commands, real file system) through tauri-driver.
// Flow: open app, create a book, edit, save, reload the page and reopen the book from disk.
const skip = nativeSupport();
if (skip) console.warn(`[native e2e] skipped: ${skip}`);

describe.skipIf(skip)("native smoke", () => {
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

  it("creates, edits, saves and reopens a book", async () => {
    const { driver } = session;
    await useEnglish(driver);
    await stubFolderDialog(driver, root);

    await click(driver, "New project");
    await (await labelled(driver, "Title")).sendKeys("Native Book");
    await (await labelled(driver, "Author")).sendKeys("Tester");
    await click(driver, "Choose…");
    await click(driver, "Create book");

    await driver.wait(
      until.elementLocated(
        By.xpath("//*[contains(@class,'ProseMirror')]//h1[normalize-space(.)='Chapter One']"),
      ),
      15_000,
    );
    await typeInEditor(driver, "Hello from tauri-driver");
    await click(driver, "Save");
    // The header's badge says "Saved" for as long as the book is saved. The app's own "Saved" notice (role status) is gone
    // after two seconds, which a slow runner can miss: the autosave may have written the file before Save was clicked.
    await driver.wait(until.elementLocated(By.xpath("//*[normalize-space(.)='Saved']")), 15_000);

    // Rust wrote real files.
    const manifest = JSON.parse(readFileSync(join(root, "cadabra.json"), "utf8"));
    expect(manifest).toMatchObject({ editions: [{ title: "Native Book", author: "Tester" }] });
    const typedText = () =>
      readdirSync(root, { recursive: true, encoding: "utf8" })
        .filter((f) => f.replaceAll("\\", "/").endsWith(".json") && f !== "cadabra.json")
        .some((f) => readFileSync(join(root, f), "utf8").includes("Hello from tauri-driver"));
    await expect.poll(typedText, { timeout: 15_000 }).toBe(true);

    // Reopen from disk after a fresh page load.
    await driver.navigate().refresh();
    await stubFolderDialog(driver, root);
    await click(driver, "Open folder");
    await driver.wait(
      until.elementLocated(
        By.xpath("//*[contains(@class,'ProseMirror')][contains(.,'Hello from tauri-driver')]"),
      ),
      15_000,
    );
  });
});
