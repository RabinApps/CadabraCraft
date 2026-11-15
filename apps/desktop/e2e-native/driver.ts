import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, join, resolve } from "node:path";
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

/** Where tauri-driver is: TAURI_DRIVER, else this job's cargo home, else the PATH (the CI image has it in /usr/local/bin). */
export function tauriDriverPath(env: NodeJS.ProcessEnv = process.env): string {
  if (env.TAURI_DRIVER) return env.TAURI_DRIVER;
  const exe = process.platform === "win32" ? "tauri-driver.exe" : "tauri-driver";
  const dirs = [
    join(env.CARGO_HOME ?? join(homedir(), ".cargo"), "bin"),
    ...(env.PATH ?? "").split(delimiter).filter(Boolean),
  ];
  return dirs.map((d) => join(d, exe)).find((f) => existsSync(f)) ?? exe;
}

export async function startSession(): Promise<Session> {
  const bin = tauriDriverPath();
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
export async function stubDialogs(driver: WebDriver, answers: string[]): Promise<void> {
  await driver.executeAsyncScript(
    `
    const [answers, done] = [arguments[0], arguments[arguments.length - 1]];
    window.__TAURI_INTERNALS__.invoke("automation_queue_dialog", { answers }).then(() => done(null), (e) => done(String(e)));
  `,
    answers,
  );
}
export const stubFolderDialog = (driver: WebDriver, folder: string) =>
  stubDialogs(driver, [folder]);

const q = (s: string) => `'${s.replace(/'/g, "")}'`;

/** Button by visible text or aria-label. */
export async function button(driver: WebDriver, name: string): Promise<WebElement> {
  const by = By.xpath(`//button[normalize-space(.)=${q(name)} or @aria-label=${q(name)}]`);
  return driver.wait(until.elementLocated(by), 15_000);
}
export async function click(driver: WebDriver, name: string): Promise<void> {
  const el = await button(driver, name);
  await driver.wait(until.elementIsVisible(el), 5_000);
  await driver.wait(until.elementIsEnabled(el), 5_000); // a wizard's Next stays disabled while it reads
  await el.click();
}
export const editor = (driver: WebDriver) =>
  driver.wait(until.elementLocated(By.css(".ProseMirror")), 15_000);
export async function labelled(driver: WebDriver, label: string): Promise<WebElement> {
  const by = By.xpath(
    `//input[@id=//label[normalize-space(.)=${q(label)}]/@for] | //input[@aria-label=${q(label)}]`,
  );
  const el = await driver.wait(until.elementLocated(by), 10_000);
  // A dialog's field exists before it is shown: typing into it then fails as "not interactable".
  await driver.wait(until.elementIsVisible(el), 5_000);
  await driver.wait(until.elementIsEnabled(el), 5_000);
  return el;
}

/**
 * The UI language is an app preference stored in localStorage; pin English so text selectors are stable. The same
 * preferences also mark the first-run welcome screen as seen (a fresh profile opens on it, covering Home) and keep the
 * sponsor dialog after an export away, as the Playwright setup does (e2e/support/fakeTauri.ts).
 */
export async function useEnglish(driver: WebDriver): Promise<void> {
  await driver.executeScript(`
    localStorage.setItem("cadabracraft.locale", "en");
    localStorage.setItem("cadabracraft.onboarding", "seen");
    localStorage.setItem("cadabracraft.sponsor", "hidden");
  `);
  await driver.navigate().refresh();
  // The page is reloading: a spec that looks for a control right away would find the old, empty document.
  await driver.wait(until.elementLocated(By.css("button")), 15_000);
}

/**
 * Asks the app to close its window the way the window frame does: the close-requested event runs the app's save-on-close
 * handler, which flushes unsaved typing and then destroys the window. WebDriver's own window close skips that handler,
 * and a page cannot call `window.close` (the capability is not granted, on purpose).
 */
export async function requestClose(driver: WebDriver): Promise<void> {
  await driver
    .executeAsyncScript(
      `
    const done = arguments[arguments.length - 1];
    window.__TAURI_INTERNALS__.invoke("plugin:event|emit", { event: "tauri://close-requested", payload: null })
      .then(() => done(null), (e) => done(String(e)));
  `,
    )
    .catch(() => {}); // the window can be gone before the answer comes back
}

/**
 * Types `text` into the open chapter, where the click puts the caret. No key chord (Ctrl+End): under WebKitWebDriver the
 * modifier stays down for the next key press, so the first characters are swallowed as shortcuts and the text is lost.
 */
export async function typeInEditor(driver: WebDriver, text: string): Promise<void> {
  const el = await editor(driver);
  await el.click();
  await el.sendKeys(text);
}

/** From the welcome screen: create a book in `root` through the real New project wizard and wait for the editor. */
export async function createBook(
  driver: WebDriver,
  root: string,
  title: string,
  author: string,
): Promise<void> {
  await useEnglish(driver);
  // The real folder dialog can create the folder it returns, and the picker records only a path that exists.
  mkdirSync(root, { recursive: true });
  await stubFolderDialog(driver, root);
  await click(driver, "New project");
  await (await labelled(driver, "Title")).sendKeys(title);
  await (await labelled(driver, "Author")).sendKeys(author);
  await click(driver, "Choose…");
  await click(driver, "Create book");
  await driver.wait(
    until.elementLocated(
      By.xpath("//*[contains(@class,'ProseMirror')]//h1[normalize-space(.)='Chapter One']"),
    ),
    15_000,
  );
}

/** Every JSON file under `root` (relative, forward slashes) whose text contains `needle`. */
export function filesContaining(root: string, needle: string): string[] {
  try {
    return readdirSync(root, { recursive: true, encoding: "utf8" })
      .map((f) => f.replaceAll("\\", "/"))
      .filter((f) => f.endsWith(".json") && readFileSync(join(root, f), "utf8").includes(needle));
  } catch {
    return []; // the folder does not exist yet
  }
}

/** Polls `check` until it returns something truthy (the effects of Rust commands reach the disk asynchronously). */
export async function eventually<T>(check: () => T | undefined | false, ms = 20_000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const v = check();
    if (v) return v;
    if (Date.now() > end) throw new Error("condition not met in time");
    await new Promise((r) => setTimeout(r, 250));
  }
}
