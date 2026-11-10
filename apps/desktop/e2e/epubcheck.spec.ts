import { expect, test, type Page } from "./support/coverage";
import { fakeTauri } from "./support/fakeTauri";
import { newProject } from "./support/helpers";

// Export > EPUB: "Check with EPUBCheck" runs the bundled validator on the exported file (the Rust side is covered by its own tests;
// here the fake backend answers with a canned report).

test.beforeEach(async ({ page }) => {
  await fakeTauri(page);
});

const dialog = (page: Page) => page.getByRole("dialog", { name: "Export book" });

async function openEpub(page: Page) {
  await newProject(page);
  await page.getByRole("button", { name: "Export", exact: true }).click();
  await dialog(page).getByRole("radio", { name: "EPUB 3" }).click();
}

const checkButton = (page: Page) => dialog(page).getByRole("button", { name: "Check EPUB" });
const calls = (page: Page) => page.evaluate(() => window.__epubcheckCalls ?? []);

test("a clean book says so and names the file it checked", async ({ page }) => {
  await openEpub(page);
  await checkButton(page).click();
  const results = dialog(page).getByRole("list", { name: "EPUBCheck results" });
  await expect(results).toContainText("EPUBCheck found no problems.");
  await expect(dialog(page).getByText("No errors or warnings.")).toBeVisible();
  await expect(
    dialog(page).getByText("EPUBCheck 5.4.0. Its messages are in English."),
  ).toBeVisible();
  expect(await calls(page)).toEqual([{ root: "/proj", path: "exports/en/book.epub" }]);
});

test("errors come before warnings, with their id, text and place", async ({ page }) => {
  await openEpub(page);
  await page.evaluate(() => {
    window.__epubcheck = {
      report: {
        version: "5.4.0",
        counts: { fatal: 0, error: 1, warning: 1, usage: 0 },
        messages: [
          {
            severity: "warning",
            id: "OPF-099",
            message: "A thing to look at",
            file: "OEBPS/nav.xhtml",
            line: null,
            column: null,
          },
          {
            severity: "error",
            id: "RSC-005",
            message: "Duplicate ID",
            file: "OEBPS/ch1.xhtml",
            line: 3,
            column: 9,
          },
        ],
        omitted: 2,
      },
    };
  });
  await checkButton(page).click();
  const rows = dialog(page).getByRole("list", { name: "EPUBCheck results" }).getByRole("listitem");
  await expect(rows).toHaveCount(3);
  await expect(rows.nth(0)).toContainText("Error:");
  await expect(rows.nth(0)).toContainText("RSC-005: Duplicate ID (OEBPS/ch1.xhtml:3)");
  await expect(rows.nth(1)).toContainText("Warning:");
  await expect(rows.nth(1)).toContainText("OPF-099: A thing to look at (OEBPS/nav.xhtml)");
  await expect(rows.nth(2)).toContainText("2 more messages are not shown");
  await expect(dialog(page).getByText("1 error, 1 warning")).toBeVisible();
});

test("a check that cannot finish says why", async ({ page }) => {
  await openEpub(page);
  const cases: [unknown, string][] = [
    [
      { kind: "no_epub" },
      "There is no exported EPUB for this edition yet. Export it first, then check it.",
    ],
    [
      { kind: "not_found", message: "x" },
      "The EPUB checker that comes with CadabraCraft was not found.",
    ],
    [{ kind: "timeout", seconds: 120 }, "The check took longer than 120 seconds and was stopped."],
    [
      { kind: "failed", message: "Unsupported class file" },
      "The EPUB check could not finish: Unsupported class file",
    ],
  ];
  for (const [error, text] of cases) {
    await page.evaluate((e) => (window.__epubcheck = { error: e as never }), error);
    await checkButton(page).click();
    await expect(dialog(page).getByRole("status")).toContainText(text);
  }
});

test("Stop ends a check in progress and asks the backend to cancel", async ({ page }) => {
  await openEpub(page);
  await page.evaluate(() => {
    window.__epubcheckHold = new Promise<void>(() => undefined);
  });
  await checkButton(page).click();
  await expect(
    dialog(page).getByText("Checking with EPUBCheck. This takes a few seconds…"),
  ).toBeVisible();
  await dialog(page).getByRole("button", { name: "Stop" }).click();
  await expect(dialog(page).getByText("Checking with EPUBCheck.")).toHaveCount(0);
  await expect(checkButton(page)).toBeEnabled();
  expect(await page.evaluate(() => window.__epubcheckCancels)).toBe(1);
});

test("with the switch on, an EPUB export stays open and checks the file it wrote", async ({
  page,
}) => {
  await openEpub(page);
  await dialog(page).getByRole("switch", { name: "Check the EPUB after every export" }).click();
  await dialog(page).getByRole("button", { name: "Export", exact: true }).click();
  await expect(dialog(page).getByRole("list", { name: "EPUBCheck results" })).toContainText(
    "EPUBCheck found no problems.",
  );
  await expect(dialog(page)).toBeVisible();
  expect(await calls(page)).toEqual([{ root: "/proj", path: "exports/en/book.epub" }]);
  // The choice is remembered for the next export.
  expect(
    await page.evaluate(
      () => JSON.parse(localStorage.getItem("cadabracraft.settings")!).validateEpub,
    ),
  ).toBe(true);
});

test("with the switch off, an export closes the dialog and nothing is checked", async ({
  page,
}) => {
  await openEpub(page);
  await dialog(page).getByRole("button", { name: "Export", exact: true }).click();
  await expect(dialog(page)).toHaveCount(0);
  expect(await calls(page)).toEqual([]);
});
