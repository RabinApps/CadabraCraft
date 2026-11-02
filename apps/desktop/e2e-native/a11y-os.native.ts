import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { By } from "selenium-webdriver";
import { nativeSupport, startSession, useEnglish, type Session } from "./driver";

// Written for tauri-driver on Windows (WebView2) and Linux (WebKitGTK). NOT RUN: this Mac cannot host tauri-driver
// (see nativeSupport), and no spec in this directory has run against a real driver yet.
// Shape of tauri-apps/tauri#15624: NVDA loses WebView2 content after the window is deactivated and activated again.
const skip = nativeSupport();
if (skip) console.warn(`[native e2e] skipped: ${skip}`);

describe.skipIf(skip)("native accessibility basics", () => {
  let session: Session;
  beforeAll(async () => {
    session = await startSession();
  });
  afterAll(async () => {
    await session?.stop();
  });

  it("has a window title and web content is the active document", async () => {
    const { driver } = session;
    await useEnglish(driver);
    expect((await driver.getTitle()).trim()).not.toBe("");
    expect(await driver.executeScript<boolean>("return document.hasFocus()")).toBe(true);
  });

  it("keeps focus in web content after the window is deactivated and activated again", async () => {
    const { driver } = session;
    const original = await driver.getWindowHandle();
    const first = await driver.findElement(By.css("button"));
    await driver.executeScript("arguments[0].focus()", first);
    // Deactivation: WebDriver cannot switch OS windows, so the page gets the blur and focus events the OS sends.
    await driver.executeScript("window.dispatchEvent(new Event('blur'))");
    await driver.switchTo().window(original);
    await driver.executeScript("window.dispatchEvent(new Event('focus'))");
    const active = await driver.executeScript<string>(
      "return document.activeElement ? document.activeElement.tagName : ''",
    );
    expect(active).toBe("BUTTON");
  });

  it("opens the native-dialog routes from the keyboard (buttons are in the Tab order)", async () => {
    const { driver } = session;
    for (const name of ["New project", "Open folder"]) {
      const ok = await driver.executeScript<boolean>(
        `const b=[...document.querySelectorAll("button")].find((b)=>b.textContent.trim()===arguments[0]); return !!b && !b.disabled && b.tabIndex>=0`,
        name,
      );
      expect(ok, name).toBe(true);
    }
  });
});
