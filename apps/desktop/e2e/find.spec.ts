import { expect, test, type Page } from "@playwright/test";
import { fakeTauri } from "./support/fakeTauri";
import { newProject, addPage } from "./support/helpers";

test.beforeEach(async ({ page }) => {
  await fakeTauri(page);
});

test.describe("find and replace", () => {
  const bar = (page: Page) => page.getByRole("search", { name: "Find and replace" });
  async function withText(page: Page) {
    await newProject(page);
    await page.locator(".ProseMirror").click();
    await page.keyboard.press("ControlOrMeta+End");
    await page.keyboard.type(" The cat sat. The cat ran. A cat slept.");
  }

  test("finds, steps, replaces one, replaces all in one undo step, and Escape clears it", async ({
    page,
  }) => {
    await withText(page);
    await page.keyboard.press("ControlOrMeta+f");
    await expect(bar(page)).toBeVisible();
    await expect(bar(page).getByLabel("Find", { exact: true })).toBeFocused();
    await page.keyboard.type("cat");
    await expect(bar(page).getByText("1 of 3")).toBeVisible();
    await expect(page.locator(".search-match")).toHaveCount(3);
    const current = () =>
      page
        .locator(".search-match-current")
        .evaluate((el) => Array.from(document.querySelectorAll(".search-match")).indexOf(el));
    const first = await current();
    await page.keyboard.press("Enter");
    await expect(bar(page).getByText("2 of 3")).toBeVisible();
    expect(await current()).not.toBe(first);
    await page.keyboard.press("Shift+Enter");
    await expect(bar(page).getByText("1 of 3")).toBeVisible();

    await bar(page).getByLabel("Replace with").fill("dog");
    await bar(page).getByRole("button", { name: "Replace", exact: true }).click();
    await expect(page.locator(".ProseMirror")).toContainText("The dog sat.");
    await expect(bar(page).getByText("1 of 2")).toBeVisible();
    await bar(page).getByRole("button", { name: "Replace all" }).click();
    await expect(page.locator(".ProseMirror")).not.toContainText("cat");
    await expect(bar(page).getByText("No results")).toBeVisible();
    await expect(bar(page).getByRole("button", { name: "Replace all" })).toBeDisabled();

    await page.locator(".ProseMirror").click();
    await page.keyboard.press("ControlOrMeta+z");
    await expect(page.locator(".ProseMirror")).toContainText(
      "The dog sat. The cat ran. A cat slept.",
    ); // one step undid Replace all only

    await page.keyboard.press("ControlOrMeta+f");
    await page.keyboard.press("Escape");
    await expect(bar(page)).toHaveCount(0);
    await expect(page.locator(".search-match")).toHaveCount(0);
    await expect(page.locator(".ProseMirror")).toBeFocused();
  });

  test("toggles match case and whole word, and Cmd+Alt+F hides the replace row", async ({
    page,
  }) => {
    await withText(page);
    await page.keyboard.press("ControlOrMeta+f");
    await page.keyboard.type("the");
    await expect(page.locator(".search-match")).toHaveCount(2);
    await bar(page).getByRole("button", { name: "Match case" }).click();
    await expect(bar(page).getByRole("button", { name: "Match case" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(bar(page).getByText("No results")).toBeVisible();
    await bar(page).getByRole("button", { name: "Match case" }).click();
    await bar(page).getByRole("button", { name: "Whole word" }).click();
    await expect(page.locator(".search-match")).toHaveCount(2);
    await expect(bar(page).getByLabel("Replace with")).toBeVisible();
    await page.keyboard.press("ControlOrMeta+Alt+f");
    await expect(bar(page).getByLabel("Replace with")).toHaveCount(0);
  });

  test("All chapters: counts the whole book, steps into other chapters, and replaces everywhere with one book undo", async ({
    page,
  }) => {
    await newProject(page);
    const typeInPage = async (text: string) => {
      await page.locator(".ProseMirror").click();
      await page.keyboard.press("ControlOrMeta+End");
      await page.keyboard.type(text);
    };
    await typeInPage(" owl one owl");
    await page.getByRole("button", { name: "Add chapter", exact: true }).click();
    await expect(page.locator(".ProseMirror h1")).toHaveText("Chapter 2");
    await typeInPage("owl two");
    await page.getByRole("button", { name: "Add chapter", exact: true }).click();
    await expect(page.locator(".ProseMirror h1")).toHaveText("Chapter 3");
    await typeInPage("nothing here");
    await addPage(page, "Dedication");
    await typeInPage(" owl dedication");
    await page.getByRole("button", { name: "Chapter One", exact: true }).click();
    await expect(page.locator(".ProseMirror")).toContainText("owl one owl");

    await page.keyboard.press("ControlOrMeta+f");
    await page.keyboard.type("owl");
    await expect(bar(page).getByText("1 of 2")).toBeVisible(); // this chapter only
    const all = bar(page).getByRole("button", { name: "All chapters" });
    await expect(all).toHaveAttribute("aria-pressed", "false");
    await all.click();
    // Reading order: Dedication (1), Chapter One (2), Chapter 2 (1), Chapter 3 (0).
    await expect(bar(page).getByText("2 of 4")).toBeVisible();
    await bar(page).getByLabel("Find", { exact: true }).press("Enter");
    await expect(bar(page).getByText("3 of 4")).toBeVisible();
    await bar(page).getByLabel("Find", { exact: true }).press("Enter");
    await expect(page.locator(".ProseMirror")).toContainText("owl two"); // opened Chapter 2
    await expect(bar(page).getByText("4 of 4")).toBeVisible();
    await expect(page.locator(".search-match-current")).toHaveText("owl");
    await bar(page).getByLabel("Find", { exact: true }).press("Enter"); // wraps to the first page
    await expect(page.locator(".ProseMirror")).toContainText("owl dedication");
    await expect(bar(page).getByText("1 of 4")).toBeVisible();
    await bar(page).getByLabel("Find", { exact: true }).press("Shift+Enter"); // back to the last match
    await expect(page.locator(".ProseMirror")).toContainText("owl two");
    await expect(bar(page).getByText("4 of 4")).toBeVisible();

    await bar(page).getByLabel("Replace with").fill("dog");
    await bar(page).getByRole("button", { name: "Replace all" }).click();
    await expect(bar(page).getByText("No results")).toBeVisible();
    await expect(page.locator(".ProseMirror")).toContainText("dog two");
    const disk = () =>
      page.evaluate(() =>
        Object.entries((window as any).__disk)
          .filter(([k]) => /\.json$/.test(k) && !k.includes(".cadabra") && k !== "cadabra.json")
          .map(([, v]) => v as string)
          .join("\n"),
      );
    expect(await disk()).not.toContain("owl");
    expect((await disk()).match(/dog/g)).toHaveLength(4);
    await page.getByRole("button", { name: "Chapter One", exact: true }).click();
    await expect(page.locator(".ProseMirror")).toContainText("dog one dog");

    await page.keyboard.press("ControlOrMeta+Alt+z"); // one book undo restores every page
    await expect.poll(async () => ((await disk()).match(/owl/g) ?? []).length).toBe(4);
    await expect(page.locator(".ProseMirror")).toContainText("owl one owl");
    await page.getByRole("button", { name: "Chapter 2", exact: true }).click();
    await expect(page.locator(".ProseMirror")).toContainText("owl two");
  });

  test("Regex: invalid pattern, captures, $& and $$, and literal replacement when off", async ({
    page,
  }) => {
    await withText(page);
    await page.keyboard.press("ControlOrMeta+f");
    const find = bar(page).getByLabel("Find", { exact: true });
    const regex = bar(page).getByRole("button", { name: "Regex" });
    await expect(regex).toHaveAttribute("aria-pressed", "false");
    await find.fill("c.t");
    await expect(bar(page).getByText("No results")).toBeVisible();
    await regex.click();
    await expect(regex).toHaveAttribute("aria-pressed", "true");
    await expect(bar(page).getByText("1 of 3")).toBeVisible();

    const errors: string[] = [];
    page.on("console", (m) => {
      if (m.type() === "error") errors.push(m.text());
    });
    page.on("pageerror", (e) => errors.push(String(e)));
    await find.fill("(");
    await expect(bar(page).getByText("Invalid pattern")).toBeVisible();
    await expect(bar(page).getByRole("button", { name: "Replace all" })).toBeDisabled();
    await expect(bar(page).getByRole("button", { name: "Replace", exact: true })).toBeDisabled();
    await find.fill("c(?=a)");
    await expect(bar(page).getByText("Invalid pattern")).toBeVisible();
    await find.fill("(a)\\1");
    await expect(bar(page).getByText("Invalid pattern")).toBeVisible();
    await expect(page.locator(".search-match")).toHaveCount(0);
    expect(errors).toEqual([]);

    await find.fill("The (c\\w+) (\\w+)\\.");
    await expect(bar(page).getByText("1 of 2")).toBeVisible();
    await bar(page).getByLabel("Replace with").fill("$2 $1 [$&] $$5");
    await bar(page).getByRole("button", { name: "Replace all" }).click();
    await expect(page.locator(".ProseMirror")).toContainText(
      "sat cat [The cat sat.] $5 ran cat [The cat ran.] $5 A cat slept.",
    );
    await page.locator(".ProseMirror").click();
    await page.keyboard.press("ControlOrMeta+z");
    await expect(page.locator(".ProseMirror")).toContainText(
      "The cat sat. The cat ran. A cat slept.",
    );

    await regex.click();
    await find.fill("cat");
    await bar(page).getByLabel("Replace with").fill("$&");
    await bar(page).getByRole("button", { name: "Replace all" }).click();
    await expect(page.locator(".ProseMirror")).toContainText("The $& sat. The $& ran. A $& slept.");
  });

  test("Regex in All chapters: replaces book-wide with captures, one book undo", async ({
    page,
  }) => {
    await newProject(page);
    const typeInPage = async (text: string) => {
      await page.locator(".ProseMirror").click();
      await page.keyboard.press("ControlOrMeta+End");
      await page.keyboard.type(text);
    };
    await typeInPage(" id-1 id-2");
    await page.getByRole("button", { name: "Add chapter", exact: true }).click();
    await expect(page.locator(".ProseMirror h1")).toHaveText("Chapter 2");
    await typeInPage("id-3");
    await page.getByRole("button", { name: "Chapter One", exact: true }).click();
    await expect(page.locator(".ProseMirror")).toContainText("id-1 id-2");

    await page.keyboard.press("ControlOrMeta+f");
    await bar(page).getByRole("button", { name: "Regex" }).click();
    await bar(page).getByRole("button", { name: "All chapters" }).click();
    await bar(page).getByLabel("Find", { exact: true }).fill("id-(\\d)");
    await expect(bar(page).getByText("1 of 3")).toBeVisible();
    await bar(page).getByLabel("Replace with").fill("item$1");
    await bar(page).getByRole("button", { name: "Replace all" }).click();
    await expect(bar(page).getByText("No results")).toBeVisible();
    const disk = () =>
      page.evaluate(() =>
        Object.entries((window as any).__disk)
          .filter(([k]) => /\.json$/.test(k) && !k.includes(".cadabra") && k !== "cadabra.json")
          .map(([, v]) => v as string)
          .join("\n"),
      );
    expect(await disk()).toContain("item1 item2");
    expect(await disk()).toContain("item3");
    expect(await disk()).not.toContain("id-");
    await page.keyboard.press("ControlOrMeta+Alt+z");
    await expect.poll(async () => ((await disk()).match(/id-\d/g) ?? []).length).toBe(3);
  });

  /** Chapter One (2 owls), Chapter 2 (1), Chapter 3 (0) and a Dedication (1); Chapter One is left open. */
  async function owlBook(page: Page) {
    await newProject(page);
    const typeInPage = async (text: string) => {
      await page.locator(".ProseMirror").click();
      await page.keyboard.press("ControlOrMeta+End");
      await page.keyboard.type(text);
    };
    await typeInPage(" owl one owl");
    await page.getByRole("button", { name: "Add chapter", exact: true }).click();
    await expect(page.locator(".ProseMirror h1")).toHaveText("Chapter 2");
    await typeInPage("owl two");
    await page.getByRole("button", { name: "Add chapter", exact: true }).click();
    await expect(page.locator(".ProseMirror h1")).toHaveText("Chapter 3");
    await typeInPage("nothing here");
    await addPage(page, "Dedication");
    await typeInPage(" owl dedication");
    await page.getByRole("button", { name: "Chapter One", exact: true }).click();
    await expect(page.locator(".ProseMirror")).toContainText("owl one owl");
  }

  test("All chapters: results list shows pages with counts, opens a page on click, and is absent when off", async ({
    page,
  }) => {
    await owlBook(page);
    await page.keyboard.press("ControlOrMeta+f");
    await page.keyboard.type("owl");
    const list = bar(page).getByRole("list", { name: "Results by page" });
    await expect(list).toHaveCount(0); // chip is off
    await bar(page).getByRole("button", { name: "All chapters" }).click();
    const rows = list.getByRole("button");
    await expect(rows).toHaveCount(3);
    await expect(
      list.getByRole("button", { name: "Front matter: Dedication, 1 match", exact: true }),
    ).toBeVisible();
    await expect(
      list.getByRole("button", { name: "Chapter One, 2 matches", exact: true }),
    ).toHaveAttribute("aria-current", "true");
    await expect(
      list.getByRole("button", { name: "Chapter 2, 1 match", exact: true }),
    ).toBeVisible();
    await expect(list.getByRole("button", { name: "Chapter 3" })).toHaveCount(0);

    await list.getByRole("button", { name: "Chapter 2, 1 match" }).click();
    await expect(page.locator(".ProseMirror")).toContainText("owl two");
    await expect(page.locator(".search-match-current")).toHaveText("owl");
    await expect(bar(page).getByText("4 of 4")).toBeVisible();
    await expect(list.getByRole("button", { name: "Chapter 2, 1 match" })).toHaveAttribute(
      "aria-current",
      "true",
    );

    await bar(page).getByLabel("Find", { exact: true }).fill("zzz");
    await expect(list).toHaveCount(0); // no matches
    await bar(page).getByLabel("Find", { exact: true }).fill("owl");
    await expect(rows).toHaveCount(3);
    await bar(page).getByRole("button", { name: "All chapters" }).click();
    await expect(list).toHaveCount(0);
  });

  test("All chapters: results list works with Regex and refreshes after Replace all", async ({
    page,
  }) => {
    await owlBook(page);
    await page.keyboard.press("ControlOrMeta+f");
    await bar(page).getByRole("button", { name: "All chapters" }).click();
    await bar(page).getByRole("button", { name: "Regex" }).click();
    const find = bar(page).getByLabel("Find", { exact: true });
    const list = bar(page).getByRole("list", { name: "Results by page" });
    await find.fill("(");
    await expect(bar(page).getByText("Invalid pattern")).toBeVisible();
    await expect(list).toHaveCount(0);
    await find.fill("o.l");
    await expect(list.getByRole("button")).toHaveCount(3);
    await find.fill("owl two");
    await expect(list.getByRole("button")).toHaveCount(1);
    await find.fill("o.l");
    await bar(page).getByLabel("Replace with").fill("dog");
    await bar(page).getByRole("button", { name: "Replace all" }).click();
    await expect(bar(page).getByText("No results")).toBeVisible();
    await expect(list).toHaveCount(0);
    await page.keyboard.press("ControlOrMeta+Alt+z");
    await expect(list.getByRole("button")).toHaveCount(3);
  });

  test("All chapters: results list scrolls past its row limit and fits a phone", async ({
    page,
  }) => {
    await newProject(page);
    for (let i = 0; i < 4; i++) {
      await page.locator(".ProseMirror").click();
      await page.keyboard.press("ControlOrMeta+End");
      await page.keyboard.type(
        " owl with a rather long sentence so that nothing could possibly fit",
      );
      await page.getByRole("button", { name: "Add chapter", exact: true }).click();
      await expect(page.locator(".ProseMirror h1")).toHaveText(`Chapter ${i + 2}`);
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator(".ProseMirror").click();
    await page.keyboard.press("ControlOrMeta+f");
    await page.keyboard.type("owl");
    await bar(page).getByRole("button", { name: "All chapters" }).click();
    const list = bar(page).getByRole("list", { name: "Results by page" });
    await expect(list.getByRole("button")).toHaveCount(4);
    const first = await list.getByRole("button").first().boundingBox();
    expect(first!.height).toBeGreaterThanOrEqual(44);
    const box = await list.boundingBox();
    expect(box!.height).toBeLessThanOrEqual(133);
    expect(await list.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true);
    const bb = await bar(page).boundingBox();
    expect(bb!.x + bb!.width).toBeLessThanOrEqual(390);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
  });

  test("is not available while reading", async ({ page }) => {
    await withText(page);
    await page.getByRole("radio", { name: "Read" }).click();
    await page.keyboard.press("ControlOrMeta+f");
    await expect(bar(page)).toHaveCount(0);
  });

  test("fits a phone without horizontal overflow", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await withText(page);
    await page.keyboard.press("ControlOrMeta+f");
    await page.keyboard.type("cat");
    await expect(bar(page)).toBeVisible();
    const box = await bar(page).boundingBox();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(390);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    await expect(bar(page).getByRole("button", { name: "Close" })).toBeVisible();
  });
});
