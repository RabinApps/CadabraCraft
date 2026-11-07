import { expect, test, type Page } from "./support/coverage";
import { fakeTauri } from "./support/fakeTauri";
import { newProject, seedChapters } from "./support/helpers";

// Smart quotes, dashes and the ellipsis while typing (app setting `smartTypography`, off by default).
// See architecture.md, "Smart typography".

const seedSetting = (page: Page, smartTypography: boolean) =>
  page.addInitScript((on) => {
    localStorage.setItem(
      "cadabracraft.settings",
      JSON.stringify({ typewriterScroll: false, smartTypography: on }),
    );
  }, smartTypography);

const last = (page: Page) => page.locator(".ProseMirror p").last();

/**
 * Waits until ProseMirror's own selection is where the browser's caret is. A click moves the caret at once, but the editor
 * learns of it on the next `selectionchange`; a key typed before that is handled at the old position.
 */
const synced = (page: Page) =>
  expect
    .poll(() =>
      page.evaluate(() => {
        const { view, state } = (
          document.querySelector(".ProseMirror") as unknown as {
            editor: {
              view: {
                domSelectionRange: () => { anchorNode: Node; anchorOffset: number };
                posAtDOM: (n: Node, o: number) => number;
              };
              state: { selection: { anchor: number } };
            };
          }
        ).editor;
        const r = view.domSelectionRange();
        return view.posAtDOM(r.anchorNode, r.anchorOffset) === state.selection.anchor;
      }),
    )
    .toBe(true);

/** A new book with the caret in its (empty) first paragraph. */
async function writing(page: Page, on = true) {
  await fakeTauri(page);
  await seedSetting(page, on);
  await newProject(page);
  await last(page).click();
  await synced(page);
}

test("quotes, dashes and the ellipsis stay as typed while the setting is off (the default)", async ({
  page,
}) => {
  await writing(page, false);
  await page.keyboard.type("\"Hi\" -- it's... 'ok'");
  await expect(last(page)).toHaveText("\"Hi\" -- it's... 'ok'");
});

test("the setting is off when nothing is stored", async ({ page }) => {
  await fakeTauri(page);
  await newProject(page);
  await last(page).click();
  await synced(page);
  await page.keyboard.type('"x"');
  await expect(last(page)).toHaveText('"x"');
});

test("with the setting on, typing makes curly quotes, apostrophes, dashes and an ellipsis", async ({
  page,
}) => {
  await writing(page);
  await page.keyboard.type("\"Don't go,\" she said -- 'now'--- wait...");
  await expect(last(page)).toHaveText("“Don’t go,” she said – ‘now’— wait…");
});

test("primes after a digit and a leading apostrophe are right", async ({ page }) => {
  await writing(page);
  await page.keyboard.type("He is 5'10\" tall. Back in the '90s, 'tis true.");
  await expect(last(page)).toHaveText("He is 5'10\" tall. Back in the ’90s, ’tis true.");
});

test("a quote at the start of a block opens, and the first dash typed is an en dash", async ({
  page,
}) => {
  await writing(page);
  await page.keyboard.type('"One."');
  await page.keyboard.press("Enter");
  await page.keyboard.type("'Two' a--b");
  await expect(page.locator(".ProseMirror p").nth(-2)).toHaveText("“One.”");
  await expect(last(page)).toHaveText("‘Two’ a–b");
});

test("Backspace right after a conversion puts back the typed characters", async ({ page }) => {
  await writing(page);
  await page.keyboard.type("a--");
  await expect(last(page)).toHaveText("a–");
  await page.keyboard.press("Backspace");
  await expect(last(page)).toHaveText("a--");
  await page.keyboard.type(" b...");
  await expect(last(page)).toHaveText("a-- b…");
  await page.keyboard.press("Backspace");
  await expect(last(page)).toHaveText("a-- b...");
  await page.keyboard.type(' "');
  await expect(last(page)).toHaveText("a-- b... “");
  await page.keyboard.press("Backspace");
  await expect(last(page)).toHaveText('a-- b... "');
  // A second Backspace is an ordinary one.
  await page.keyboard.press("Backspace");
  await expect(last(page)).toHaveText("a-- b... ");
});

test("the code mark is left alone, and so is text after it", async ({ page }) => {
  await writing(page);
  await page.keyboard.press("ControlOrMeta+e");
  await page.keyboard.type("\"x\" -- 'y'...");
  await page.keyboard.press("ControlOrMeta+e");
  await page.keyboard.type(' "z" --');
  await expect(last(page).locator("code")).toHaveText("\"x\" -- 'y'...");
  await expect(last(page)).toHaveText("\"x\" -- 'y'... “z” –");
});

test("a code block is left alone", async ({ page }) => {
  await fakeTauri(page);
  await seedSetting(page, true);
  await newProject(page);
  const doc = {
    type: "doc",
    content: [
      { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "Code" }] },
      { type: "codeBlock", content: [{ type: "text", text: "x" }] },
    ],
  };
  await seedChapters(page, [doc]);
  await page.locator(".ProseMirror pre").click();
  await page.keyboard.press("End");
  await synced(page);
  await page.keyboard.type(" = \"s\" -- 'c'...");
  await expect(page.locator(".ProseMirror pre")).toHaveText("x = \"s\" -- 'c'...");
});

test("inside a passage marked as another language, that language's quotes are used", async ({
  page,
}) => {
  await fakeTauri(page);
  await seedSetting(page, true);
  await newProject(page);
  const doc = {
    type: "doc",
    content: [
      { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "Mixed" }] },
      {
        type: "paragraph",
        content: [
          { type: "text", text: "Say " },
          { type: "text", text: "bonjour amis", marks: [{ type: "lang", attrs: { lang: "fr" } }] },
        ],
      },
    ],
  };
  await seedChapters(page, [doc]);
  const fr = page.locator('.ProseMirror span[lang="fr"]');
  await fr.click();
  await synced(page);
  // Inside the passage (the click landed in the middle of it): the quote after a space opens with a French guillemet.
  await page.keyboard.type(' "');
  await expect(fr).toHaveText(/ \u00ab\u202f/);
  await expect(fr).not.toHaveText(/\u201c/);
  // At the end of the paragraph the mark does not continue, so the book's language (English) is used.
  await page.evaluate(() =>
    (
      document.querySelector(".ProseMirror") as unknown as {
        editor: { commands: { focus: (p: string) => boolean } };
      }
    ).editor.commands.focus("end"),
  );
  await synced(page);
  await page.keyboard.type(' "x"');
  await expect(last(page)).toHaveText(/ \u201cx\u201d$/);
});

test("turning the setting on while writing takes effect at once, without a new editor", async ({
  page,
}) => {
  await writing(page, false);
  await page.keyboard.type('"a" ');
  await page.evaluate(async () => {
    (await import("/src/state/view/editorPrefs.ts" as string)).useSettings
      .getState()
      .set({ smartTypography: true });
  });
  await page.keyboard.type('"b"');
  await expect(last(page)).toHaveText('"a" “b”');
  await page.evaluate(async () => {
    (await import("/src/state/view/editorPrefs.ts" as string)).useSettings
      .getState()
      .set({ smartTypography: false });
  });
  await page.keyboard.type(' "c"');
  await expect(last(page)).toHaveText('"a" “b” "c"');
});

test("nothing converts while an IME composes; the composed text is converted when it ends", async ({
  page,
  browserName,
}) => {
  test.skip(browserName !== "chromium", "CDP input events are Chromium only");
  await writing(page);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Input.imeSetComposition", {
    text: '"',
    selectionStart: 1,
    selectionEnd: 1,
  });
  await expect(last(page)).toHaveText('"');
  await cdp.send("Input.insertText", { text: '"' });
  await expect.poll(async () => (await last(page).textContent())!.length).toBeGreaterThan(0);
  // Whatever the engine did with the composition, the typed text was never turned into a pair of different glyphs before it ended.
  await expect(last(page)).not.toHaveText("““");
});

test("the typed glyphs are what is saved", async ({ page }) => {
  await writing(page);
  await page.keyboard.type('"Hi" -- it\'s...');
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("status")).toHaveText("Saved");
  const saved = await page.evaluate(
    () => window.__disk["manuscript/001-chapter-one.json"] as string,
  );
  expect(saved).toContain("“Hi” – it’s…");
  expect(saved).not.toContain("&");
});

const command = (page: Page, id: string) =>
  page.evaluate(async (c) => {
    const cmds = (await import("/src/state/app/commands.ts" as string)).getCommands();
    const enabled = Boolean(cmds[c]?.enabled);
    if (enabled) cmds[c].run();
    return enabled;
  }, id);
const isEnabled = (page: Page, id: string) =>
  page.evaluate(
    async (c) =>
      Boolean((await import("/src/state/app/commands.ts" as string)).getCommands()[c]?.enabled),
    id,
  );
const stored = (page: Page) =>
  page.evaluate(() => JSON.parse(localStorage.getItem("cadabracraft.settings") ?? "{}"));
const note = (page: Page) =>
  page.locator("[aria-live=polite]").filter({ hasText: /quotes and dashes|No straight/ });

test.describe("Settings and the Format menu", () => {
  test("the Settings switch is named, off by default, persists and takes effect while writing", async ({
    page,
  }) => {
    await fakeTauri(page);
    await newProject(page);
    await page.getByRole("button", { name: "Settings" }).click();
    const sw = page.getByRole("switch", { name: "Smart quotes and dashes" });
    await expect(sw).not.toBeChecked();
    await expect(
      page.getByText(
        "Turns straight quotes, -- and ... into typographic ones as you type. Off by default.",
      ),
    ).toBeVisible();
    await sw.focus();
    await page.keyboard.press("Space");
    await expect(sw).toBeChecked();
    expect((await stored(page)).smartTypography).toBe(true);
    await page.reload();
    await page.getByRole("button", { name: "Open folder" }).click();
    await page.getByRole("button", { name: "Settings" }).click();
    await expect(page.getByRole("switch", { name: "Smart quotes and dashes" })).toBeChecked();
  });

  test("turning the Settings switch on takes effect in the open editor", async ({ page }) => {
    await writing(page, false);
    await page.evaluate(async () => {
      (await import("/src/state/view/editorPrefs.ts" as string)).useSettings
        .getState()
        .set({ smartTypography: true });
    });
    await page.keyboard.type('"on"');
    await expect(last(page)).toHaveText("“on”");
  });

  test("Convert Quotes and Dashes is disabled without a selection, converts one, is one undo and is announced", async ({
    page,
  }) => {
    await writing(page, false);
    await page.keyboard.type("\"a\" -- 'b'... it's");
    expect(await isEnabled(page, "editor.convertQuotes")).toBe(false);
    await page.keyboard.press("ControlOrMeta+a");
    await expect.poll(() => isEnabled(page, "editor.convertQuotes")).toBe(true);
    await expect(note(page)).toHaveCount(0);
    await command(page, "editor.convertQuotes");
    await expect(last(page)).toHaveText("“a” – ‘b’… it’s");
    await expect(note(page)).toHaveText("Converted quotes and dashes in the selection");
    await page.keyboard.press("ControlOrMeta+z");
    await expect(last(page)).toHaveText("\"a\" -- 'b'... it's");
    await page.keyboard.press("ControlOrMeta+a");
    await expect.poll(() => isEnabled(page, "editor.convertQuotes")).toBe(true);
    await command(page, "editor.convertQuotes");
    await expect(last(page)).toHaveText("“a” – ‘b’… it’s");
    // Nothing is left to convert the second time.
    await page.keyboard.press("ControlOrMeta+a");
    await expect.poll(() => isEnabled(page, "editor.convertQuotes")).toBe(true);
    await command(page, "editor.convertQuotes");
    await expect(note(page)).toHaveText("No straight quotes or dashes to convert in the selection");
  });

  test("the menu model lists it in the Format menu", async ({ page }) => {
    await writing(page, false);
    const model = await page.evaluate(() =>
      JSON.stringify(
        (window as unknown as { __cadabraMenu: { model: unknown } }).__cadabraMenu.model,
      ),
    );
    expect(model).toContain("Convert Quotes and Dashes");
    expect(model).toContain("editor.convertQuotes");
  });
});
