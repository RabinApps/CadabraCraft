import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import type { Page } from "@playwright/test";
import { expect, test } from "./support/coverage";
import { fakeTauri } from "./support/fakeTauri";
import { chapterAction, newProject } from "./support/helpers";
import { screens as allScreens } from "./support/a11yScreens";

/**
 * The same screens as a11y.spec.ts through two engines other than axe-core: IBM Equal Access (WCAG 2.2 A and AA) and
 * HTML_CodeSniffer (the Pa11y engine, WCAG 2.1 AA). Each engine has rules and judgements the others lack.
 */
const require = createRequire(import.meta.url);
const ibmSource = readFileSync(require.resolve("accessibility-checker-engine/ace.js"), "utf8");
const htmlcsSource = readFileSync(require.resolve("html_codesniffer/build/HTMLCS.js"), "utf8");

/** Reviewed findings that are not defects; each has the reason. Keep this list short. */
const IBM_IGNORED: Record<string, string> = {
  aria_hidden_nontabbable:
    "Radix hides the page behind an open modal with aria-hidden; focus is trapped in the dialog, so those controls cannot be reached",
  skip_main_exists:
    "the skip link is there (SkipLink, visually hidden until focused); IBM does not count a clipped link",
  input_label_exists:
    "the label is there but visually hidden (sr-only); axe label rule (a11y.spec.ts, settings) accepts it",
};
const HTMLCS_IGNORED: Record<string, string> = {};

interface IbmReport {
  results: { ruleId: string; value: string[]; path: { dom: string } }[];
}
interface HtmlCs {
  process: (standard: string, doc: Document, done: () => void) => void;
  getMessages: () => { type: number; code: string; element: Element }[];
}

async function settle(page: Page) {
  await page.evaluate(() =>
    Promise.all(document.getAnimations().map((a) => a.finished.catch(() => {}))),
  );
}

async function ibm(page: Page): Promise<string[]> {
  await settle(page);
  await page.evaluate(ibmSource);
  return page.evaluate(async () => {
    const w = window as unknown as {
      ace: { Checker: new () => { check: (d: Document, p: string[]) => Promise<IbmReport> } };
    };
    const report = await new w.ace.Checker().check(document, ["WCAG_2_2"]);
    return report.results
      .filter((r) => r.value[0] === "VIOLATION" && r.value[1] === "FAIL")
      .map((r) => `${r.ruleId}: ${r.path.dom}`);
  });
}

async function htmlcs(page: Page): Promise<string[]> {
  await settle(page);
  await page.evaluate(htmlcsSource);
  return page.evaluate(
    () =>
      new Promise<string[]>((resolve) => {
        const w = window as unknown as { HTMLCS: HtmlCs };
        w.HTMLCS.process("WCAG2AA", document, () => {
          const errors = w.HTMLCS.getMessages().filter((m) => m.type === 1);
          resolve(
            errors.map(
              (m) =>
                `${m.code}: ${m.element.tagName.toLowerCase()}${m.element.id ? "#" + m.element.id : ""}`,
            ),
          );
        });
      }),
  );
}

function unexpected(found: string[], ignored: Record<string, string>) {
  return found.filter((f) => !Object.keys(ignored).some((k) => f.startsWith(k)));
}

test.beforeEach(async ({ page }) => {
  await fakeTauri(page);
});

const screens: [string, (page: Page) => Promise<void>][] = [
  ["home", async (p) => void (await p.goto("/"))],
  [
    "new book dialog",
    async (p) => {
      await p.goto("/");
      await p.getByRole("button", { name: "New project" }).click();
      await expect(p.getByRole("dialog", { name: "New book" })).toBeVisible();
    },
  ],
  [
    "settings",
    async (p) => {
      await p.goto("/");
      await p.getByRole("button", { name: "Settings" }).click();
      await expect(p.getByRole("heading", { name: "Settings", level: 1 })).toBeVisible();
    },
  ],
  ["editor", async (p) => newProject(p)],
  [
    "export dialog",
    async (p) => {
      await newProject(p);
      await p.getByRole("button", { name: "Export", exact: true }).click();
      await expect(p.getByRole("dialog", { name: "Export book" })).toBeVisible();
    },
  ],
  [
    "history dialog",
    async (p) => {
      await newProject(p);
      await chapterAction(p, "Chapter One", "History");
      await expect(p.getByRole("dialog", { name: "History · Chapter One" })).toBeVisible();
    },
  ],
];

// The newest panels and dialogs, from the shared list the other accessibility specs use.
const ENGINE_SCREENS = [
  "chapter icon picker",
  "Templates panel",
  "References panel with a PDF",
  "Reference viewer (PDF)",
  "Book snapshots, one snapshot selected",
  "Licenses dialog",
];
for (const s of allScreens.filter((x) => ENGINE_SCREENS.includes(x.name)))
  screens.push([s.name, s.open]);

for (const [name, open] of screens) {
  test(`IBM Equal Access finds no violations on ${name}`, async ({ page }) => {
    await open(page);
    expect(unexpected(await ibm(page), IBM_IGNORED)).toEqual([]);
  });

  test(`HTML_CodeSniffer finds no errors on ${name}`, async ({ page }) => {
    await open(page);
    expect(unexpected(await htmlcs(page), HTMLCS_IGNORED)).toEqual([]);
  });
}
