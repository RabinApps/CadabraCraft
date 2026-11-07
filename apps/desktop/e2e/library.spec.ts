import { expect, test, type Page } from "./support/coverage";
import { fakeTauri } from "./support/fakeTauri";
import { newProject } from "./support/helpers";

// The Library: every known book with covers, sort, search and series groups. The folder scan itself is Rust (tested there);
// here the fake backend returns what the scan would.

const day = 24 * 60 * 60 * 1000;
const now = Date.now();

const book = (
  root: string,
  title: string,
  o: {
    author?: string;
    words?: number;
    ago?: number;
    series?: string;
    number?: string;
    cover?: string;
  } = {},
) => ({
  root,
  title,
  openedAt: now - (o.ago ?? 0) * day,
  editedAt: now - (o.ago ?? 0) * day,
  stats: {
    author: o.author ?? "",
    chapters: 3,
    words: o.words ?? 1000,
    chapterNo: 1,
    chapterTitle: "One",
    ...(o.cover ? { cover: o.cover } : {}),
    ...(o.series ? { series: o.series } : {}),
    ...(o.number ? { seriesNumber: o.number } : {}),
  },
});

const SHELF = [
  book("/b/salt", "The Salt Orchard", {
    author: "Mara Quill",
    words: 48210,
    ago: 0,
    series: "The Orchard Cycle",
    number: "1",
  }),
  book("/b/ashes", "Orchard Ashes", {
    author: "Mara Quill",
    words: 9000,
    ago: 9,
    series: "The Orchard Cycle",
    number: "3",
  }),
  book("/b/glass", "The Glass Orchard", {
    author: "Mara Quill",
    words: 31480,
    ago: 3,
    series: "The Orchard Cycle",
    number: "2",
  }),
  book("/b/light", "Letters to a Lighthouse", { author: "Jon Verity", words: 62900, ago: 7 }),
  book("/b/guide", "Field Guide to Quiet Things", { author: "Ines Calder", words: 21040, ago: 14 }),
];

const seed = (page: Page, list: unknown[]) =>
  page.addInitScript((l) => localStorage.setItem("cadabracraft.recents", JSON.stringify(l)), list);

const openLibrary = async (page: Page) => {
  await page.goto("/");
  await page.getByRole("button", { name: /^View all books/ }).click();
  await expect(page.getByRole("heading", { name: "Library", level: 1 })).toBeVisible();
};
const titlesShown = (page: Page) =>
  page
    .getByRole("main")
    .getByRole("listitem")
    .evaluateAll((els) => els.map((e) => e.querySelector("span.truncate")?.textContent));

test.beforeEach(async ({ page }) => {
  await fakeTauri(page);
});

test("library: Home links to it, it lists every book, and Home comes back", async ({ page }) => {
  await seed(page, SHELF);
  await openLibrary(page);
  await expect(page.getByText("5 books", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Home" }).click();
  await expect(page.getByRole("heading", { name: "Your books" })).toBeVisible();
});

test("library: books beyond Home's recent list are all there, scanned ones without a time", async ({
  page,
}) => {
  const many = Array.from({ length: 30 }, (_, i) => book(`/m/${i}`, `Book ${i + 1}`, { ago: i }));
  many.push({
    root: "/m/scanned",
    title: "Found In A Scan",
    openedAt: 0,
    scanned: { author: "Scan Author" },
  } as never);
  await seed(page, many);
  await page.goto("/");
  // Home shows the newest eight and the "Start a new book" tile.
  await expect(
    page.getByRole("region", { name: "Recent projects" }).getByRole("listitem"),
  ).toHaveCount(9);
  await page.getByRole("button", { name: "View all books (31)" }).click();
  await expect(page.getByText("31 books", { exact: true })).toBeVisible();
  const row = page.getByRole("listitem").filter({ hasText: "Found In A Scan" });
  await expect(row).toContainText("Scan Author");
  await expect(row).toContainText("Not opened yet");
  await expect(row).not.toContainText("Edited");
  await expect(row).not.toContainText("Opened");
});

test("library: sorts by last edited, title, author, words and series order, and remembers it", async ({
  page,
}) => {
  await seed(page, SHELF);
  await openLibrary(page);
  // Grouping would reorder by series; look at the plain order.
  await page.getByRole("checkbox", { name: "Group by series" }).uncheck();
  const sort = page.getByLabel("Sort by");
  await expect(sort).toHaveValue("edited");
  expect(await titlesShown(page)).toEqual([
    "The Salt Orchard",
    "The Glass Orchard",
    "Letters to a Lighthouse",
    "Orchard Ashes",
    "Field Guide to Quiet Things",
  ]);
  await sort.selectOption("title");
  expect((await titlesShown(page))[0]).toBe("Field Guide to Quiet Things");
  await sort.selectOption("author");
  expect((await titlesShown(page))[0]).toBe("Field Guide to Quiet Things");
  await sort.selectOption("words");
  expect((await titlesShown(page))[0]).toBe("Letters to a Lighthouse");
  await sort.selectOption("series");
  expect(await titlesShown(page)).toEqual([
    "The Salt Orchard",
    "The Glass Orchard",
    "Orchard Ashes",
    "Field Guide to Quiet Things",
    "Letters to a Lighthouse",
  ]);
  await page.reload();
  await page.getByRole("button", { name: /^View all books/ }).click();
  await expect(page.getByLabel("Sort by")).toHaveValue("series");
});

test("library: search is a fuzzy match on title, author and series, and says what is shown", async ({
  page,
}) => {
  await seed(page, SHELF);
  await openLibrary(page);
  const search = page.getByRole("searchbox", { name: "Search books" });
  await search.fill("orch");
  await expect(page.getByText("3 of 5 books")).toBeVisible();
  // Letters in order, not a substring: "tsl" is T-S-L in "The Salt Orchard".
  await search.fill("tsl");
  await expect(page.getByRole("button", { name: /^The Salt Orchard/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /^Orchard Ashes/ })).toHaveCount(0);
  await search.fill("verity");
  await expect(page.getByRole("button", { name: /^Letters to a Lighthouse/ })).toBeVisible();
  await expect(page.getByText("1 of 5 books")).toBeVisible();
  await search.fill("zzzz");
  await expect(page.getByText("No book matches “zzzz”.")).toBeVisible();
  await search.fill("");
  await expect(page.getByText("5 books", { exact: true })).toBeVisible();
});

test("library: books of a series are grouped in reading order with a number badge", async ({
  page,
}) => {
  await seed(page, SHELF);
  await openLibrary(page);
  const series = page.getByRole("region", { name: "The Orchard Cycle" });
  await expect(series.getByRole("heading", { name: /The Orchard Cycle/ })).toContainText("3 books");
  expect(
    await series
      .getByRole("listitem")
      .evaluateAll((els) => els.map((e) => e.querySelector("span.truncate")?.textContent)),
  ).toEqual(["The Salt Orchard", "The Glass Orchard", "Orchard Ashes"]);
  await expect(series.getByText("Book 1")).toBeVisible();
  await expect(series.getByText("Book 3")).toBeVisible();
  const alone = page.getByRole("region", { name: "Books without a series" });
  await expect(alone.getByRole("heading", { name: /Not in a series/ })).toBeVisible();
  await expect(alone.getByRole("listitem")).toHaveCount(2);
  await page.getByRole("checkbox", { name: "Group by series" }).uncheck();
  await expect(page.getByRole("heading", { name: /The Orchard Cycle/ })).toHaveCount(0);
});

test("library: the list layout shows the same books in rows and is remembered", async ({
  page,
}) => {
  await seed(page, SHELF);
  await openLibrary(page);
  await page.getByRole("radio", { name: "List" }).click();
  await expect(page.getByRole("listitem").first()).toContainText("The Salt Orchard");
  expect(await page.evaluate(() => localStorage.getItem("cadabracraft.library"))).toContain("list");
  await page.reload();
  await page.getByRole("button", { name: /^View all books/ }).click();
  await expect(page.getByRole("radio", { name: "List" })).toBeChecked();
});

test("library: a book whose folder is gone keeps its entry with a message until it is removed", async ({
  page,
}) => {
  await seed(page, [
    book("/gone", "Moved Book", { ago: 0 }),
    book("/b/salt", "The Salt Orchard", { ago: 1 }),
  ]);
  await openLibrary(page);
  await page.getByRole("button", { name: /^Moved Book/ }).click();
  const row = page.getByRole("listitem").filter({ hasText: "Moved Book" });
  await expect(
    row.getByText("Folder not found. Remove it from the list or move it back."),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "Library", level: 1 })).toBeVisible();
  await page.getByRole("button", { name: "Remove Moved Book from the Library" }).click();
  await expect(page.getByRole("button", { name: /^Moved Book/ })).toHaveCount(0);
  await expect(page.getByText("1 book", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem("cadabracraft.recents"))).not.toContain(
    "/gone",
  );
});

test("library: removing a book takes it off the list but not off the disk", async ({ page }) => {
  await newProject(page);
  await page.goto("/");
  await page.evaluate(() => {
    const list = JSON.parse(localStorage.getItem("cadabracraft.recents") ?? "[]");
    localStorage.setItem(
      "cadabracraft.recents",
      JSON.stringify([...list, { root: "/b/other", title: "Other", openedAt: 1 }]),
    );
  });
  await page.reload();
  await page.getByRole("button", { name: /^View all books/ }).click();
  await page.getByRole("button", { name: "Remove Other from the Library" }).click();
  await expect(page.getByRole("button", { name: /^Other/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^E2E Book/ })).toBeVisible();
  expect(await page.evaluate(() => window.__disk["cadabra.json"])).toContain("E2E Book");
});

test("library: opening a book from it opens the book", async ({ page }) => {
  await newProject(page);
  await page.reload();
  await page.getByRole("button", { name: /^View all books/ }).click();
  await page.getByRole("button", { name: /^E2E Book/ }).click();
  await expect(page.locator(".ProseMirror h1")).toHaveText("Chapter One");
});

test("library: File > Library and the command palette open it, from inside a book too", async ({
  page,
}) => {
  await newProject(page);
  await page.waitForFunction(() => "__cadabraMenu" in window);
  await page.evaluate(() =>
    (window as never as { __cadabraMenu: { run: (id: string) => void } }).__cadabraMenu.run(
      "file.library",
    ),
  );
  await expect(page.getByRole("heading", { name: "Library", level: 1 })).toBeVisible();
  await page.getByRole("button", { name: /^E2E Book/ }).click();
  await expect(page.locator(".ProseMirror h1")).toHaveText("Chapter One");
  await page.keyboard.press("ControlOrMeta+k");
  await page.getByRole("combobox", { name: "Command palette" }).fill("library");
  await page
    .getByRole("option", { name: /Library/ })
    .first()
    .click();
  await expect(page.getByRole("heading", { name: "Library", level: 1 })).toBeVisible();
});

test("library: adding a folder of books lists what the scan found and says what it skipped", async ({
  page,
}) => {
  await seed(page, [book("/b/salt", "The Salt Orchard", { ago: 1 })]);
  await page.addInitScript(() => {
    window.__scanResult = {
      books: [
        {
          root: "/b/salt",
          title: "The Salt Orchard",
          author: "",
          language: "en",
          cover: null,
          series: null,
          seriesNumber: null,
        },
        {
          root: "/b/new",
          title: "A New Find",
          author: "Pat Writer",
          language: "en",
          cover: null,
          series: "Finds",
          seriesNumber: "2",
        },
      ],
      skipped: 1,
      truncated: true,
    };
  });
  await openLibrary(page);
  await page.getByRole("button", { name: "Add a folder of books…" }).click();
  const note = page.getByRole("status").filter({ hasText: "Added 1 new book." });
  await expect(note).toContainText("1 were already in the Library.");
  await expect(note).toContainText("1 folder with a damaged cadabra.json was skipped.");
  await expect(note).toContainText("pick a smaller folder");
  const row = page.getByRole("region", { name: "Finds" });
  await expect(row).toContainText("A New Find");
  await expect(row).toContainText("Book 2");
  await expect(row).toContainText("Not opened yet");
});

test("library: cancelling the folder picker changes nothing", async ({ page }) => {
  await seed(page, SHELF);
  await page.addInitScript(() => {
    window.__libraryPick = null;
  });
  await openLibrary(page);
  await page.getByRole("button", { name: "Add a folder of books…" }).click();
  await expect(page.getByRole("button", { name: "Add a folder of books…" })).toBeEnabled();
  await expect(page.getByRole("status").filter({ hasText: "Added" })).toHaveCount(0);
  await expect(page.getByText("5 books", { exact: true })).toBeVisible();
});

test("library: a cover is shown as a picture, read from the other book's folder and cached", async ({
  page,
}) => {
  const PIXEL =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
  await seed(page, [
    book("/b/pic", "Pictured", { cover: "assets/c.png" }),
    book("/b/plain", "Plain Cover"),
  ]);
  await page.addInitScript((px) => {
    window.__books = {
      "/b/pic": { "assets/c.png": Array.from(atob(px), (c) => c.charCodeAt(0)) },
    };
  }, PIXEL);
  await openLibrary(page);
  const pictured = page.getByRole("listitem").filter({ hasText: "Pictured" });
  await expect(pictured.locator("img")).toBeVisible();
  // No picture: the title on a tint, and nothing broken.
  await expect(
    page.getByRole("listitem").filter({ hasText: "Plain Cover" }).locator("img"),
  ).toHaveCount(0);
});
