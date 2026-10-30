import { expect, test, type Page } from "./support/coverage";
import { fakeTauri } from "./support/fakeTauri";
import { newProject } from "./support/helpers";

// Coverage note: V8 counters are lost on page.reload(), so these specs never reload after the interaction they cover.

test.beforeEach(async ({ page }) => {
  await fakeTauri(page);
});

const pm = (page: Page) => page.locator(".ProseMirror");
const run = (page: Page, id: string) =>
  page.evaluate(async (c) => {
    (await import("/src/state/commands.ts" as string)).runCommand(c);
  }, id);
const setting = (page: Page, patch: Record<string, unknown>) =>
  page.evaluate(async (p) => {
    (await import("/src/state/editorPrefs.ts" as string)).useSettings.getState().set(p);
  }, patch);
const notice = (page: Page, text: string) => page.getByRole("status").filter({ hasText: text });
/** Caret at the end of the empty paragraph under the chapter title. */
async function toEnd(page: Page) {
  await pm(page).locator("p").last().click();
  // A real key makes ProseMirror read the click's selection before a synthetic paste.
  await page.keyboard.type("Q");
  await page.keyboard.press("Backspace");
}
/** A paste event the way a code editor sends it: text/plain only. */
const paste = (page: Page, text: string) =>
  page.evaluate((t) => {
    const dt = new DataTransfer();
    dt.setData("text/plain", t);
    pm().dispatchEvent(
      new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }),
    );
    function pm() {
      return document.querySelector(".ProseMirror")!;
    }
  }, text);
async function selectParagraph(page: Page, which: "last" | "heading") {
  await page.evaluate((w) => {
    const els = [
      ...document.querySelectorAll(w === "heading" ? ".ProseMirror h1" : ".ProseMirror p"),
    ];
    const r = document.createRange();
    r.selectNodeContents(w === "heading" ? els[0]! : els.pop()!);
    const sel = getSelection()!;
    sel.removeAllRanges();
    sel.addRange(r);
  }, which);
  await page.evaluate(
    () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))),
  );
}
const dlg = (page: Page) => page.getByRole("dialog", { name: "Paste as styled text?" });

test.describe("typewriter scrolling", () => {
  test("keeps the caret centered, and tolerates a missing scroller", async ({ page }) => {
    await newProject(page);
    await setting(page, { typewriterScroll: true });
    await toEnd(page);
    for (let i = 0; i < 40; i++) await page.keyboard.press("Enter");
    await expect
      .poll(() => pm(page).evaluate((el) => el.closest<HTMLElement>(".overflow-y-auto")!.scrollTop))
      .toBeGreaterThan(0);
    await pm(page).evaluate((el) =>
      el.closest(".overflow-y-auto")!.classList.remove("overflow-y-auto"),
    );
    await page.keyboard.type("still typing");
    await expect(pm(page)).toContainText("still typing");
  });
});

test.describe("pasting HTML text", () => {
  const HTML = "<p>The gate was <b>old</b></p>";

  test("a second paste while the dialog is open is swallowed", async ({ page }) => {
    await newProject(page);
    await toEnd(page);
    await paste(page, HTML);
    await expect(dlg(page)).toBeVisible();
    await paste(page, "<p>second</p>");
    await expect(dlg(page)).toHaveCount(1);
    await dlg(page).getByRole("button", { name: "Keep as text" }).click();
    await expect(pm(page)).not.toContainText("second");
  });

  test("a conversion that drops something says so (ask, then remembered convert)", async ({
    page,
  }) => {
    await newProject(page);
    await toEnd(page);
    const odd = '<p>a <a href="javascript:void(0)">link</a> b</p>';
    await paste(page, odd);
    await dlg(page).getByRole("button", { name: "Convert" }).click();
    await expect(notice(page, "that could not be kept")).toBeVisible();
    await pm(page).locator("p").last().click();
    await setting(page, { rawHtmlPaste: "convert" });
    await paste(page, "<h5>x</h5><p>y</p>");
    await expect(pm(page)).toContainText("x");
    await expect(dlg(page)).toHaveCount(0);
  });

  test("remembering Keep as text saves the choice", async ({ page }) => {
    await newProject(page);
    await toEnd(page);
    await paste(page, HTML);
    await dlg(page).getByLabel("Remember my choice").check();
    await dlg(page).getByRole("button", { name: "Keep as text" }).click();
    expect(
      await page.evaluate(
        () => JSON.parse(localStorage.getItem("cadabracraft.settings") ?? "{}").rawHtmlPaste,
      ),
    ).toBe("text");
  });

  test("HTML that is nested too deeply is pasted as text with a notice", async ({ page }) => {
    await newProject(page);
    await toEnd(page);
    await paste(page, `${"<div>".repeat(600)}x`);
    await expect(
      notice(page, "Could not convert the HTML, so it was pasted as text"),
    ).toBeVisible();
    await expect(dlg(page)).toHaveCount(0);
  });

  test("a paste that cannot be read falls back to the default paste", async ({ page }) => {
    await newProject(page);
    await toEnd(page);
    await page.evaluate(() => {
      const ev = new ClipboardEvent("paste", { bubbles: true, cancelable: true });
      Object.defineProperty(ev, "clipboardData", {
        value: {
          types: [],
          files: [],
          // Unreadable for the editor component only; everything else (TipTap, ProseMirror) sees an empty clipboard.
          getData: () => {
            if (new Error().stack!.includes("editor/Editor.tsx")) throw new Error("unreadable");
            return "";
          },
        },
      });
      document.querySelector(".ProseMirror")!.dispatchEvent(ev);
    });
    await expect(dlg(page)).toHaveCount(0);
    await expect(pm(page)).toBeVisible();
  });

  test("a paste without clipboard data is left alone", async ({ page }) => {
    await newProject(page);
    await toEnd(page);
    await page.evaluate(() =>
      document
        .querySelector(".ProseMirror")!
        .dispatchEvent(new ClipboardEvent("paste", { bubbles: true, cancelable: true })),
    );
    await expect(dlg(page)).toHaveCount(0);
  });

  test("content that cannot land where the caret is is refused (remembered convert, then ask)", async ({
    page,
  }) => {
    await newProject(page);
    // A scene break has no text, so it cannot be put into a heading.
    await pm(page).locator("h1").click();
    await page.keyboard.press("End");
    await page.keyboard.type("Q");
    await page.keyboard.press("Backspace");
    await setting(page, { rawHtmlPaste: "convert" });
    await paste(page, "<hr>");
    await expect(dlg(page)).toHaveCount(0);
    await setting(page, { rawHtmlPaste: "ask" });
    await paste(page, "<hr>");
    await dlg(page).getByRole("button", { name: "Convert" }).click();
    await expect(notice(page, "Nothing was pasted here")).toBeVisible();
    // Empty content (an empty paragraph) is refused the same way.
    await toEnd(page);
    await paste(page, "<p></p>");
    await dlg(page).getByRole("button", { name: "Convert" }).click();
    await expect(notice(page, "Nothing was pasted here").first()).toBeVisible();
  });

  test("a selection that runs from outside a table into a cell is left to the default paste and cannot be converted", async ({
    page,
  }) => {
    await newProject(page);
    await toEnd(page);
    await page.keyboard.type("<b>before</b>");
    await page.keyboard.press("Enter");
    await run(page, "editor.table");
    await page
      .getByRole("dialog", { name: "Insert table" })
      .getByRole("button", { name: "Insert" })
      .click();
    await pm(page).locator("td").first().click();
    await page.keyboard.type("<i>cell</i>");
    const across = async () => {
      await page.evaluate(() => {
        const text = (el: Element) => {
          const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
          return w.nextNode() as Text | null;
        };
        const before = document.querySelector(".ProseMirror p")!;
        const cell = document.querySelector(".ProseMirror td")!;
        const start = text(before);
        const end = text(cell);
        if (!start || !end) throw new Error("Expected text nodes before and inside the table");
        const r = document.createRange();
        r.setStart(start, 0);
        r.setEnd(end, end.textContent!.length);
        const sel = getSelection()!;
        sel.removeAllRanges();
        sel.addRange(r);
      });
      await page.evaluate(
        () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))),
      );
    };
    await across();
    await paste(page, "<p>x</p>");
    await expect(dlg(page)).toHaveCount(0);
    // The browser's default paste replaces both endpoints of the cross-table selection.
    // Restore a text node in the cell before testing the conversion guard with another range.
    await pm(page).locator("td").first().click();
    await page.keyboard.type("cell again");
    await expect(async () => {
      await across();
      await run(page, "edit.convertHtml");
      await expect(notice(page, "Select text inside one cell or paragraph")).toBeVisible({
        timeout: 500,
      });
    }).toPass();
  });
});

test.describe("Convert HTML in Selection", () => {
  test("refuses a selection that is too large", async ({ page }) => {
    await newProject(page);
    await toEnd(page);
    // Paragraphs of 200 letters: one 1 MB paragraph is a worst case for laying the text out in pages.
    await paste(page, Array.from({ length: 5_000 }, () => "a".repeat(200)).join("\n")); // longer than the limit: the default paste
    await page.keyboard.press("ControlOrMeta+a");
    await expect
      .poll(() => page.evaluate(() => getSelection()?.toString().length))
      .toBeGreaterThan(1_000_000);
    await run(page, "edit.convertHtml");
    await expect(notice(page, "The selection is too large to convert")).toBeVisible();
  });

  test("says when the HTML cannot be converted or inserted", async ({ page }) => {
    await newProject(page);
    await toEnd(page);
    // One input event: 3,000 typed keystrokes take longer than the test timeout when the machine is busy.
    await page.keyboard.insertText(`${"<div>".repeat(600)}x`);
    await selectParagraph(page, "last");
    await run(page, "edit.convertHtml");
    await expect(notice(page, "Could not convert the HTML in the selection")).toBeVisible();

    // An empty paragraph converts to nothing, so there is nothing to put back.
    await page.keyboard.press("Backspace");
    await page.keyboard.type("<p></p>");
    await selectParagraph(page, "last");
    await expect(async () => {
      await run(page, "edit.convertHtml");
      await expect(notice(page, "Could not convert the HTML in the selection")).toBeVisible({
        timeout: 500,
      });
    }).toPass();
  });
});

test("Find and Replace commands open the bar, and a second shortcut within a moment or with a dialog open is ignored", async ({
  page,
}) => {
  await newProject(page);
  await toEnd(page);
  await run(page, "edit.findReplace");
  const bar = page.getByRole("search", { name: "Find and replace" });
  await expect(bar.getByLabel("Replace with")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(bar).toHaveCount(0);

  // Two key events in the same task: the second is a duplicate of the native menu's call.
  await expect(async () => {
    await page.evaluate(() => {
      for (let i = 0; i < 2; i++)
        window.dispatchEvent(
          new KeyboardEvent("keydown", { key: "f", code: "KeyF", ctrlKey: true, bubbles: true }),
        );
    });
    await expect(bar).toHaveCount(1, { timeout: 500 });
  }).toPass();
  await page.keyboard.press("Escape");

  // With a dialog open the shortcut does nothing.
  await paste(page, "<p>x</p>");
  await expect(dlg(page)).toBeVisible();
  await page.evaluate(() =>
    window.dispatchEvent(
      new KeyboardEvent("keydown", { key: "f", code: "KeyF", ctrlKey: true, bubbles: true }),
    ),
  );
  await expect(bar).toHaveCount(0);
});

test.describe("toolbar", () => {
  const tb = (page: Page, name: string) =>
    page.getByRole("toolbar", { name: "Formatting" }).getByRole("button", { name, exact: true });
  const add = (page: Page) => page.getByRole("dialog", { name: "Add image" });
  const link = (page: Page) => page.getByRole("dialog", { name: "Add link" });

  test("arrow keys, Home and End move between the buttons, and wrap", async ({ page }) => {
    await newProject(page);
    const bar = page.getByRole("toolbar", { name: "Formatting" });
    const buttons = bar.locator("button:not(:disabled)");
    const last = (await buttons.count()) - 1;
    await buttons.nth(1).focus();
    await page.keyboard.press("ArrowRight");
    await expect(buttons.nth(2)).toBeFocused();
    await page.keyboard.press("ArrowLeft");
    await expect(buttons.nth(1)).toBeFocused();
    await page.keyboard.press("End");
    await expect(buttons.nth(last)).toBeFocused();
    await page.keyboard.press("ArrowRight"); // wraps to the first
    await expect(buttons.nth(0)).toBeFocused();
    await page.keyboard.press("ArrowLeft"); // and back to the last
    await expect(buttons.nth(last)).toBeFocused();
    await page.keyboard.press("Home");
    await expect(buttons.nth(0)).toBeFocused();
    await page.keyboard.press("x"); // not a navigation key: focus stays
    await expect(buttons.nth(0)).toBeFocused();
  });

  test("every button and menu command runs", async ({ page }) => {
    await newProject(page);
    await toEnd(page);
    await page.keyboard.type("some words");
    for (const name of [
      "Bold",
      "Italic",
      "Underline",
      "Small caps",
      "Heading 2",
      "Heading 3",
      "Heading 1",
      "Block quote",
      "Bulleted list",
      "Numbered list",
      "Scene break",
      "Footnote",
      "Undo",
      "Redo",
    ])
      await tb(page, name).click();
    for (const id of [
      "editor.strike",
      "editor.code",
      "editor.superscript",
      "editor.subscript",
      "editor.codeBlock",
      "editor.bold",
      "editor.italic",
      "editor.underline",
      "editor.smallCaps",
      "editor.h1",
      "editor.h2",
      "editor.h3",
      "editor.quote",
      "editor.bullets",
      "editor.numbers",
      "editor.sceneBreak",
      "editor.footnote",
    ])
      await run(page, id);
    await expect(pm(page)).toBeVisible();
  });

  test("images: cancelled picker, caption, no caption, Cancel and Escape", async ({ page }) => {
    await page.addInitScript(() => {
      const real = window.__TAURI_INTERNALS__.invoke;
      window.__TAURI_INTERNALS__.invoke = (cmd, a, o) =>
        cmd === "pick_image" && sessionStorage.getItem("pickNothing")
          ? Promise.resolve(null)
          : real(cmd, a, o);
    });
    await newProject(page);
    await toEnd(page);
    await page.evaluate(() => sessionStorage.setItem("pickNothing", "1"));
    await tb(page, "Image").click();
    await expect(add(page)).toHaveCount(0);
    await page.evaluate(() => sessionStorage.removeItem("pickNothing"));

    await tb(page, "Image").click();
    await add(page).getByRole("button", { name: "Cancel" }).click();
    await expect(add(page)).toHaveCount(0);
    await run(page, "editor.image");
    await expect(add(page)).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(add(page)).toHaveCount(0);

    await tb(page, "Image").click();
    await add(page).getByLabel("Description (alt text)").fill("Plain");
    await add(page).getByRole("button", { name: "Insert" }).click();
    await expect(pm(page).locator("figure img")).toHaveAttribute("alt", "Plain");
    await expect(pm(page).locator("figcaption")).toHaveText("");

    await tb(page, "Image").click();
    await add(page).getByLabel("Caption").fill("With caption");
    await add(page).getByRole("button", { name: "Insert" }).click();
    await expect(pm(page).locator("figcaption")).toHaveText("With caption");
  });

  test("links: refused address, no selection, apply, remove, Cancel and Escape", async ({
    page,
  }) => {
    await newProject(page);
    await toEnd(page);
    await page.keyboard.type("link me");
    // No selection.
    await tb(page, "Link").click();
    await link(page).getByLabel("Address").fill("https://example.com");
    await link(page).getByRole("button", { name: "Apply" }).click();
    await expect(link(page).getByRole("alert")).toHaveText(
      "Select the text you want to link first.",
    );
    await link(page).getByRole("button", { name: "Cancel" }).click();
    await expect(link(page)).toHaveCount(0);

    await selectParagraph(page, "last");
    await tb(page, "Link").click();
    await link(page).getByLabel("Address").fill("javascript:alert(1)");
    await link(page).getByRole("button", { name: "Apply" }).click();
    await expect(link(page).getByRole("alert")).toHaveText("That address can't be used as a link.");
    await link(page).getByLabel("Address").fill("https://example.com");
    await expect(link(page).getByRole("alert")).toHaveCount(0);
    await link(page).getByRole("button", { name: "Apply" }).click();
    await expect(link(page)).toHaveCount(0);
    await expect(pm(page).locator("a")).toHaveAttribute("href", "https://example.com/");

    // The caret is in the link now: the button removes it.
    await expect(tb(page, "Link")).toHaveAttribute("aria-pressed", "true");
    await tb(page, "Link").click();
    await expect(pm(page).locator("a")).toHaveCount(0);

    await run(page, "editor.link");
    await expect(link(page)).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(link(page)).toHaveCount(0);
  });
});

test.describe("tables", () => {
  const dialog = (page: Page) => page.getByRole("dialog", { name: "Insert table" });

  test("size is clamped, Cancel and Escape close, and every table command runs", async ({
    page,
  }) => {
    await newProject(page);
    await toEnd(page);
    await run(page, "editor.table");
    await dialog(page).getByRole("button", { name: "Cancel" }).click();
    await expect(dialog(page)).toHaveCount(0);
    await run(page, "editor.table");
    await page.keyboard.press("Escape");
    await expect(dialog(page)).toHaveCount(0);

    await run(page, "editor.table");
    await dialog(page).getByLabel("Rows").fill("");
    await dialog(page).getByLabel("Columns").fill("");
    await dialog(page).getByRole("button", { name: "Insert" }).click();
    await expect(pm(page).locator("tr")).toHaveCount(1);
    await expect(pm(page).locator("tr").first().locator("th")).toHaveCount(1);

    for (const id of [
      "editor.tableAddRow",
      "editor.tableAddColumn",
      "editor.tableDeleteRow",
      "editor.tableDeleteColumn",
      "editor.tableHeaderRow",
      "editor.tableDelete",
    ])
      await run(page, id);
    await expect(pm(page).locator("table")).toHaveCount(0);
  });
});
