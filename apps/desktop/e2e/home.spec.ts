import { expect, test } from "./support/coverage";
import { fakeTauri } from "./support/fakeTauri";
import { newProject } from "./support/helpers";

test.beforeEach(async ({ page }) => {
  await fakeTauri(page);
});

test("recent projects: listed after opening, reopenable, removable, and missing folders are flagged", async ({
  page,
}) => {
  await newProject(page);
  await page.reload();
  const recent = page.getByRole("region", { name: "Recent projects" });
  await expect(recent.getByText("E2E Book")).toBeVisible();
  // Never written into the project file.
  expect(await page.evaluate(() => window.__disk["cadabra.json"])).not.toContain("/proj");
  await recent
    .getByRole("button", { name: /E2E Book/ })
    .first()
    .click();
  await expect(page.locator(".ProseMirror h1")).toHaveText("Chapter One");

  await page.evaluate(() =>
    localStorage.setItem(
      "cadabracraft.recents",
      JSON.stringify([
        { root: "/gone", title: "Moved Book", openedAt: 2 },
        { root: "/proj", title: "E2E Book", openedAt: 1 },
      ]),
    ),
  );
  await page.reload();
  await recent
    .getByRole("button", { name: /Moved Book/ })
    .first()
    .click();
  await expect(recent.getByText("Folder not found.")).toBeVisible();
  await page.getByRole("button", { name: "Remove Moved Book from recent projects" }).click();
  await expect(recent.getByText("Moved Book")).toHaveCount(0);
  await expect(recent.getByText("E2E Book")).toBeVisible();
});

const day = 24 * 60 * 60 * 1000;

test("home dashboard: continue card, book cards with their facts, and the new book tile", async ({
  page,
}) => {
  const now = Date.now();
  await page.addInitScript(
    (list) => localStorage.setItem("cadabracraft.recents", JSON.stringify(list)),
    [
      {
        root: "/proj",
        title: "The Salt Orchard",
        openedAt: now,
        editedAt: now,
        stats: {
          author: "Mara Quill",
          chapters: 12,
          words: 48210,
          chapterNo: 7,
          chapterTitle: "The Orchard Wall",
        },
      },
      {
        root: "/other",
        title: "Letters to a Lighthouse",
        openedAt: now - 3 * day,
        editedAt: now - 3 * day,
        stats: { author: "Mara Quill", chapters: 1, words: 1, chapterNo: 0, chapterTitle: "" },
      },
      { root: "/old", title: "Old Book", openedAt: now - 2 * day },
    ],
  );
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Your books" })).toBeVisible();
  const lead = page.getByRole("region", { name: "Continue writing" });
  await expect(lead.getByRole("heading", { name: "Chapter 7 · The Orchard Wall" })).toBeVisible();
  await expect(lead.getByRole("progressbar", { name: "Place in the book" })).toHaveAttribute(
    "aria-valuenow",
    "7",
  );
  await expect(lead).toContainText("7 of 12 chapters · 48,210 words");

  const recent = page.getByRole("region", { name: "Recent projects" });
  const first = recent.getByRole("listitem").filter({ hasText: "The Salt Orchard" });
  await expect(first).toContainText("Mara Quill");
  await expect(first).toContainText("12 chapters · 48,210 words");
  await expect(first).toContainText("Edited today");
  const second = recent.getByRole("listitem").filter({ hasText: "Letters to a Lighthouse" });
  await expect(second).toContainText("1 chapter · 1 word");
  await expect(second).toContainText("Edited 3 days ago");
  // A book from before stats were kept: only when it was opened.
  const old = recent.getByRole("listitem").filter({ hasText: "Old Book" });
  await expect(old).toContainText("Opened 2 days ago");
  await expect(old).not.toContainText("chapter");

  await recent.getByRole("button", { name: "Start a new book" }).click();
  await expect(page.getByRole("dialog", { name: "New book" })).toBeVisible();
});

test("home dashboard: a book's stats are recorded while it is open", async ({ page }) => {
  await newProject(page);
  await expect
    .poll(async () =>
      page.evaluate(
        () => JSON.parse(localStorage.getItem("cadabracraft.recents") ?? "[]")[0]?.stats,
      ),
    )
    .toMatchObject({ chapters: 1, chapterNo: 1, chapterTitle: "Chapter One" });
});

test("home dashboard: View all books opens the Library with the book count, and Home returns", async ({
  page,
}) => {
  const now = Date.now();
  await page.addInitScript(
    (list) => localStorage.setItem("cadabracraft.recents", JSON.stringify(list)),
    [
      { root: "/a", title: "Alpha", openedAt: now },
      { root: "/b", title: "Beta", openedAt: now - day },
    ],
  );
  await page.goto("/");
  await page.getByRole("button", { name: "View all books (2)" }).click();
  await expect(page.getByRole("heading", { name: "Library", level: 1 })).toBeVisible();
  await expect(page.getByRole("button", { name: /^Alpha/ })).toBeVisible();
  await page.getByRole("button", { name: "Home" }).click();
  await expect(page.getByRole("heading", { name: "Your books" })).toBeVisible();
});
