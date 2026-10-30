import { expect, test, type Page } from "./support/coverage";
import { fakeTauri } from "./support/fakeTauri";
import { focusEnd, newProject, seedChapters } from "./support/helpers";

// Edge cases found by an audit of the editor's keyboard, paste and resize behaviour (see docs/testing.md).

test.beforeEach(async ({ page }) => {
  await fakeTauri(page);
  await newProject(page);
});

const ed = (page: Page) => page.locator(".ProseMirror");
const tool = (page: Page, name: string) =>
  page.getByRole("toolbar", { name: "Formatting" }).getByRole("button", { name, exact: true });
const pasteHtml = (page: Page, html: string, text = "") =>
  page.evaluate(
    ([h, t]) => {
      const dt = new DataTransfer();
      dt.setData("text/html", h!);
      dt.setData("text/plain", t!);
      document
        .querySelector(".ProseMirror")!
        .dispatchEvent(
          new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }),
        );
    },
    [html, text],
  );

test.describe("Tab", () => {
  test("on the first item of a bulleted list stays in the editor", async ({ page }) => {
    await focusEnd(page);
    await tool(page, "Bulleted list").click();
    await page.keyboard.type("only item");
    await page.keyboard.press("Tab");
    await expect(ed(page)).toBeFocused();
    await expect(ed(page).locator("ul ul")).toHaveCount(0);
    expect(await ed(page).locator("ul").textContent()).toBe("only item");
  });

  test("on the first item of a task list stays in the editor", async ({ page }) => {
    await focusEnd(page);
    await page.waitForFunction(() =>
      Boolean((window as unknown as { __cadabraMenu?: unknown }).__cadabraMenu),
    );
    await page.evaluate(() =>
      (window as unknown as { __cadabraMenu: { run: (id: string) => boolean } }).__cadabraMenu.run(
        "editor.taskList",
      ),
    );
    await page.keyboard.type("todo");
    await page.keyboard.press("Tab");
    await expect(ed(page)).toBeFocused();
  });

  test("in a heading types a tab and stays", async ({ page }) => {
    await ed(page).locator("h1").click();
    await page.keyboard.press("Tab");
    await expect(ed(page)).toBeFocused();
    expect(await ed(page).locator("h1").textContent()).toContain("\t");
  });

  test("over a selection does not replace the text", async ({ page }) => {
    await focusEnd(page);
    await page.keyboard.type("keep me");
    await ed(page).locator("p").last().click({ clickCount: 3 });
    await page.keyboard.press("Tab");
    await expect(ed(page).locator("p").last()).toHaveText("keep me");
    await expect(ed(page)).toBeFocused();
  });

  test("Shift+Tab leaves the editor", async ({ page }) => {
    await focusEnd(page);
    await page.keyboard.press("Shift+Tab");
    await expect(ed(page)).not.toBeFocused();
  });
});

test.describe("pasting from Word and the web", () => {
  test("pictures from outside the book are left out, with a notice", async ({ page }) => {
    await focusEnd(page);
    await pasteHtml(
      page,
      '<p>before <img src="https://example.test/p.png" alt="p"> after <img src="data:image/png;base64,AAAA"></p>',
      "before after",
    );
    await expect(ed(page).locator("img")).toHaveCount(0);
    await expect(ed(page)).toContainText("before");
    await expect(
      page.getByRole("status").filter({ hasText: "Pasted pictures were left out" }),
    ).toBeVisible();
  });

  test("control characters from Word never reach the chapter", async ({ page }) => {
    await focusEnd(page);
    await pasteHtml(page, "<p>one\u000btwo\u0001three</p>", "one\u000btwo\u0001three");
    await expect(ed(page)).toContainText("onetwothree".slice(0, 3));
    const saved = await page.evaluate(() => JSON.stringify(window.__disk));
    expect(saved).not.toMatch(/\\u000b|\\u0001/);
    const dom = await ed(page).textContent();
    // eslint-disable-next-line no-control-regex -- intentional: the characters that must not be there
    expect(dom).not.toMatch(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/);
  });
});

test.describe("resizing across the phone breakpoint while writing", () => {
  test("keeps the text, the caret and the focus", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await focusEnd(page);
    await page.keyboard.type("before resize ");
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.getByTestId("reflow-scroll")).toBeVisible();
    await expect(ed(page)).toContainText("before resize");
    await expect(ed(page)).toBeFocused();
    await page.keyboard.type("on the phone ");
    await page.setViewportSize({ width: 1280, height: 800 });
    await expect(page.locator(".page").first()).toBeVisible();
    await expect(ed(page)).toBeFocused();
    await page.keyboard.type("and back");
    await expect(ed(page).locator("p").last()).toHaveText("before resize on the phone and back");
  });

  test("keeps the selection", async ({ page }) => {
    await focusEnd(page);
    await page.keyboard.type("select this text");
    await ed(page).locator("p").last().click({ clickCount: 3 });
    const sel = () => page.evaluate(() => getSelection()?.toString());
    expect(await sel()).toBe("select this text");
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.getByTestId("reflow-scroll")).toBeVisible();
    await expect.poll(sel).toBe("select this text");
  });
});

test.describe("content that is wider than a phone", () => {
  const t = (text: string) => ({ type: "text", text });
  const cell = (s: string) => ({
    type: "tableCell",
    content: [{ type: "paragraph", content: [t(s)] }],
  });
  const overflow = (page: Page) =>
    page.evaluate(() => {
      const el = document.querySelector<HTMLElement>('[data-testid="reflow-scroll"]')!;
      const pm = document.querySelector<HTMLElement>(".ProseMirror")!;
      return { scroll: el.scrollWidth - el.clientWidth, pm: pm.scrollWidth - pm.clientWidth };
    });

  test("a 300-character web address wraps instead of widening the page", async ({ page }) => {
    await seedChapters(page, [
      {
        type: "doc",
        content: [
          { type: "heading", attrs: { level: 1 }, content: [t("Chapter One")] },
          { type: "paragraph", content: [t(`See https://example.test/${"a".repeat(300)} today`)] },
        ],
      } as never,
    ]);
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.getByTestId("reflow-scroll")).toBeVisible();
    const o = await overflow(page);
    expect(o.scroll).toBeLessThanOrEqual(1);
    expect(o.pm).toBeLessThanOrEqual(1);
  });

  test("a table with eight columns does not widen the page", async ({ page }) => {
    const row = {
      type: "tableRow",
      content: Array.from({ length: 8 }, (_, i) => cell(`Column ${i + 1} text`)),
    };
    await seedChapters(page, [
      {
        type: "doc",
        content: [
          { type: "heading", attrs: { level: 1 }, content: [t("Chapter One")] },
          { type: "table", content: [row, row] },
        ],
      } as never,
    ]);
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.getByTestId("reflow-scroll")).toBeVisible();
    const o = await overflow(page);
    expect(o.scroll).toBeLessThanOrEqual(1);
  });
});

const menuRun = async (page: Page, id: string) => {
  await page.waitForFunction(() => Boolean(window.__cadabraMenu));
  return page.evaluate((i) => window.__cadabraMenu.run(i) as boolean, id);
};

test.describe("Enter and Backspace at the edges of blocks", () => {
  test("Enter on an empty task item leaves the list, Backspace removes an empty item", async ({
    page,
  }) => {
    await focusEnd(page);
    await menuRun(page, "editor.taskList");
    await page.keyboard.type("one");
    await page.keyboard.press("Enter");
    await expect(ed(page).locator('li[data-type="taskItem"]')).toHaveCount(2);
    await page.keyboard.press("Backspace");
    await expect(ed(page).locator('li[data-type="taskItem"]')).toHaveCount(1);
    await expect(ed(page)).toBeFocused();
    await page.keyboard.press("Enter");
    await page.keyboard.press("Enter");
    await expect(ed(page).locator('li[data-type="taskItem"]')).toHaveCount(1);
    await page.keyboard.type("after");
    await expect(ed(page).locator('li[data-type="taskItem"]')).toHaveText("one");
    await expect(ed(page)).toContainText("after");
  });

  test("a definition list can be written with the keyboard alone", async ({ page }) => {
    await focusEnd(page);
    await menuRun(page, "editor.definitionList");
    await page.keyboard.type("Term");
    await page.keyboard.press("Enter");
    await page.keyboard.type("Meaning");
    await expect(ed(page).locator("dl dt")).toHaveText("Term");
    await expect(ed(page).locator("dl dd")).toHaveText("Meaning");
  });

  test("Enter at the end of a heading starts a paragraph, Backspace at its start joins the heading", async ({
    page,
  }) => {
    const h1 = ed(page).locator("h1");
    const box = (await h1.boundingBox())!;
    await h1.click({ position: { x: box.width - 2, y: box.height / 2 } });
    await page.waitForTimeout(150); // ProseMirror reads the click's selection on the next event
    await page.keyboard.press("Enter");
    await page.keyboard.type("Body");
    await expect(ed(page).locator("h1 + p")).toHaveText("Body");
    await expect(h1).toHaveText("Chapter One");
    for (let i = 0; i < 4; i++) await page.keyboard.press("ArrowLeft");
    await page.keyboard.press("Backspace");
    await expect(h1).toHaveText("Chapter OneBody");
  });

  test("Enter in a table cell makes a paragraph in the cell, not a new row", async ({ page }) => {
    await focusEnd(page);
    await menuRun(page, "editor.table");
    await page
      .getByRole("dialog", { name: "Insert table" })
      .getByRole("button", { name: "Insert" })
      .click();
    const rows = await ed(page).locator("tr").count();
    await ed(page).locator("td").first().click();
    await page.keyboard.type("a");
    await page.keyboard.press("Enter");
    await page.keyboard.type("b");
    await expect(ed(page).locator("td").first().locator("p")).toHaveCount(2);
    await expect(ed(page).locator("tr")).toHaveCount(rows);
  });

  test("typing over a selection replaces it, and undo and redo restore it", async ({ page }) => {
    await focusEnd(page);
    await page.keyboard.type("old words");
    await page.waitForTimeout(700); // typing within half a second is one undo step
    await ed(page).locator("p").last().click({ clickCount: 3 });
    await page.keyboard.type("new");
    await expect(ed(page).locator("p").last()).toHaveText("new");
    await page.keyboard.press("ControlOrMeta+z");
    await expect(ed(page).locator("p").last()).toHaveText("old words");
    await page.keyboard.press("ControlOrMeta+Shift+z");
    await expect(ed(page).locator("p").last()).toHaveText("new");
  });
});

test.describe("focus after dialogs", () => {
  const link = (page: Page) => page.getByRole("dialog", { name: "Add link" });
  test("returns to the text after a link is applied, cancelled or escaped", async ({ page }) => {
    await focusEnd(page);
    await page.keyboard.type("link me");
    for (const how of ["apply", "cancel", "escape"] as const) {
      await ed(page).locator("p").last().click({ clickCount: 3 });
      await tool(page, "Link").click();
      await expect(link(page)).toBeVisible();
      if (how === "apply") {
        await link(page).getByLabel("Address").fill("https://example.com");
        await link(page).getByRole("button", { name: "Apply" }).click();
      } else if (how === "cancel") {
        await link(page).getByRole("button", { name: "Cancel" }).click();
      } else await page.keyboard.press("Escape");
      await expect(link(page)).toHaveCount(0);
      await expect(ed(page), how).toBeFocused();
      if (how === "apply") await tool(page, "Link").click(); // the caret is in the link: the button removes it
    }
  });
});

test.describe("typewriter scrolling", () => {
  const scroller = (page: Page) =>
    page.evaluate(
      () =>
        document
          .querySelector<HTMLElement>(".overflow-y-auto .ProseMirror")
          ?.closest<HTMLElement>(".overflow-y-auto")?.scrollTop ?? -1,
    );

  test("follows typing but does not move the page when the author clicks", async ({ page }) => {
    const t = (text: string) => ({ type: "text", text });
    const para = (i: number) => ({
      type: "paragraph",
      content: [
        t(`Paragraph ${i}. ${"The orchard wall was old and the grass was long. ".repeat(6)}`),
      ],
    });
    await seedChapters(page, [
      {
        type: "doc",
        content: [
          { type: "heading", attrs: { level: 1 }, content: [t("Chapter One")] },
          ...Array.from({ length: 40 }, (_, i) => para(i)),
        ],
      } as never,
    ]);
    await page.evaluate(async () => {
      const prefs = await import("/src/state/editorPrefs.ts" as string);
      prefs.useSettings.getState().set({ typewriterScroll: true });
    });
    await page.locator(".ProseMirror").click({ position: { x: 100, y: 400 } });
    await page.keyboard.type("x");
    await page.waitForTimeout(300);
    // A click on another line: the page stays where it is.
    await page.evaluate(() => {
      document
        .querySelector<HTMLElement>(".overflow-y-auto .ProseMirror")!
        .closest<HTMLElement>(".overflow-y-auto")!.scrollTop = 600;
    });
    const before = await scroller(page);
    const area = (await page.locator(".ProseMirror").first().boundingBox())!;
    const view = page.viewportSize()!;
    // A point in the visible text (Playwright's own click would scroll the target into view first).
    await page.mouse.click(area.x + area.width / 2, view.height / 2 - 100);
    await page.waitForTimeout(400);
    expect(Math.abs((await scroller(page)) - before)).toBeLessThan(60);
    // Typing then follows the caret to the middle of the column.
    await page.keyboard.type("y");
    await page.waitForTimeout(400);
    expect(await scroller(page)).not.toBe(before);
  });
});

test.describe("the editor for assistive technology", () => {
  test("is a labelled multi-line textbox in the book's language and direction", async ({
    page,
  }) => {
    const box = page.getByRole("textbox", { name: "Page text" });
    await expect(box).toHaveAttribute("aria-multiline", "true");
    await expect(box).toHaveAttribute("lang", "en");
    await expect(box).toHaveAttribute("dir", "ltr");
  });
});
