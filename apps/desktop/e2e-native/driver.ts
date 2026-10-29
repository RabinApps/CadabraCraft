import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { Builder, By, until, type WebDriver, type WebElement } from "selenium-webdriver";

const PORT = 4444;
const appDir = resolve(import.meta.dirname, "..");

/** The debug binary produced by `pnpm build:native` (cargo target dir, no bundling). */
export const appBinary = join(
  appDir,
  "src-tauri",
  "target",
  "debug",
  process.platform === "win32" ? "cadabracraft.exe" : "cadabracraft",
);

/** tauri-driver only supports Linux (WebKitWebDriver) and Windows (msedgedriver). macOS has no WKWebView driver. */
export function nativeSupport(): string | null {
  if (process.platform !== "linux" && process.platform !== "win32")
    return `tauri-driver does not support ${process.platform} (no WKWebView WebDriver)`;
  if (!existsSync(appBinary)) return `app binary missing, run: pnpm build:native (${appBinary})`;
  return null;
}

export type Session = { driver: WebDriver; stop: () => Promise<void> };

export async function startSession(): Promise<Session> {
  const bin =
    process.env.TAURI_DRIVER ??
    join(
      homedir(),
      ".cargo",
      "bin",
      process.platform === "win32" ? "tauri-driver.exe" : "tauri-driver",
    );
  const proc: ChildProcess = spawn(bin, ["--port", String(PORT)], {
    stdio: ["ignore", process.stdout, process.stderr],
  });
  await new Promise((r) => setTimeout(r, 1500)); // tauri-driver prints nothing on ready; give it a moment
  const driver = await new Builder()
    .usingServer(`http://127.0.0.1:${PORT}/`)
    .withCapabilities({ browserName: "wry", "tauri:options": { application: appBinary } })
    .build();
  return {
    driver,
    async stop() {
      await driver.quit().catch(() => {});
      proc.kill();
    },
  };
}

/**
 * Native folder dialogs cannot be driven through WebDriver, and the folder picker now runs in Rust (it records the
 * path it returns, and `create_project` accepts only such a path). So the app must be built with `dev-automation`
 * (`pnpm build:native` does that): this queues `folder` as the answer to the next native dialog, which the Rust picker
 * consumes and records exactly like a real pick. Call it before each click that opens a folder dialog.
 */
export async function stubFolderDialog(driver: WebDriver, folder: string): Promise<void> {
  await driver.executeAsyncScript(
    `
    const [folder, done] = [arguments[0], arguments[arguments.length - 1]];
    window.__TAURI_INTERNALS__.invoke("automation_queue_dialog", { answers: [folder] }).then(() => done(null), (e) => done(String(e)));
  `,
    folder,
  );
}

const q = (s: string) => `'${s.replace(/'/g, "")}'`;

/** Button by visible text or aria-label. */
export async function button(driver: WebDriver, name: string): Promise<WebElement> {
  const by = By.xpath(`//button[normalize-space(.)=${q(name)} or @aria-label=${q(name)}]`);
  return driver.wait(until.elementLocated(by), 15_000);
}
export async function click(driver: WebDriver, name: string): Promise<void> {
  const el = await button(driver, name);
  await driver.wait(until.elementIsVisible(el), 5_000);
  await el.click();
}
export const editor = (driver: WebDriver) =>
  driver.wait(until.elementLocated(By.css(".ProseMirror")), 15_000);
export async function labelled(driver: WebDriver, label: string): Promise<WebElement> {
  const by = By.xpath(
    `//input[@id=//label[normalize-space(.)=${q(label)}]/@for] | //input[@aria-label=${q(label)}]`,
  );
  return driver.wait(until.elementLocated(by), 10_000);
}

/** The UI language is an app preference stored in localStorage; pin English so text selectors are stable. */
export async function useEnglish(driver: WebDriver): Promise<void> {
  await driver.executeScript(`localStorage.setItem("cadabracraft.locale", "en")`);
  await driver.navigate().refresh();
}
