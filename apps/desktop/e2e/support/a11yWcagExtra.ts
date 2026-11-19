import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import type { Browser, Page } from "@playwright/test";
import { fakeTauri } from "./fakeTauri";
import { screens } from "./a11yScreens";

/** A page in its own browser context, so one screen's saved view (Focus mode, a stub from another screen) never leaks into the next. */
export async function fresh(browser: Browser, baseURL: string | undefined): Promise<Page> {
  const context = await browser.newContext(baseURL ? { baseURL } : {});
  const page = await context.newPage();
  await fakeTauri(page);
  return page;
}

/**
 * The screens cut into `parts` consecutive runs. A sweep that opened every screen in one test ran past its time ceiling on a
 * loaded CI runner, so each run checks its own screens and a test covers one run; every screen is still opened.
 */
export function screenRuns<T>(list: T[], parts: number): T[][] {
  const size = Math.ceil(list.length / parts);
  return Array.from({ length: parts }, (_, i) => list.slice(i * size, (i + 1) * size)).filter(
    (run) => run.length > 0,
  );
}

export const named = (...names: string[]) => screens.filter((s) => names.includes(s.name));
/** The screens that hold the shell, the forms and the long-lived dialogs. */
export const MAIN = named(
  "home",
  "editor",
  "New book dialog",
  "settings",
  "settings, Audio section without voices",
  "export dialog",
  "export dialog, PDF options",
  "Book details dialog",
  "Add language dialog",
  "Add image dialog",
  "Insert table dialog",
  "Language of selection dialog",
  "Add custom entry dialog",
);

/** Every source file of the app that is not a test. */
export function sources(dir = path.join(process.cwd(), "src")): { file: string; text: string }[] {
  return readdirSync(dir).flatMap((n) => {
    const f = path.join(dir, n);
    if (n === "__tests__" || n === "node_modules" || n === "test") return [];
    if (statSync(f).isDirectory()) return sources(f);
    return /\.(tsx?|css)$/.test(n) && !/\.test\./.test(n)
      ? [{ file: path.relative(process.cwd(), f), text: readFileSync(f, "utf8") }]
      : [];
  });
}
