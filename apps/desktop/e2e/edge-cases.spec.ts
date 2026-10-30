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
