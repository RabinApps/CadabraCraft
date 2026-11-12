import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { assert, type Context } from "./context.ts";

/** Language editions: add French, write in it, switch back and forth, and pick up an outside edit of a translation file. */
export async function editionsSteps(ctx: Context) {
  await editionsPart1(ctx);
  await editionsPart2(ctx);
}

/** The page-level helpers both edition parts use. */
function editionHelpers({ app, book }: Context) {
  const manifest = () => JSON.parse(readFileSync(join(book, "cadabra.json"), "utf8"));
  const switcher = `[...document.querySelectorAll("button")].find((b) => (b.getAttribute("aria-label") ?? "").startsWith("Edition:"))`;
  const openSwitcher = () =>
    app.js(
      `(() => { const b = ${switcher}; if (!b) throw new Error("no edition switcher"); b.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0, pointerType: "mouse" })); return b.getAttribute("aria-label"); })()`,
    );
  // The switcher's items show a name and "N of M chapters", so match the start of the text.
  const pick = (start: string) =>
    app.js(
      `(() => { const i = [...document.querySelectorAll('[role="menuitem"]')].find((i) => i.textContent.trim().startsWith(${JSON.stringify(start)})); if (!i) throw new Error("no menu item: ${start}; menu items: " + JSON.stringify([...document.querySelectorAll('[role="menuitem"]')].map((x) => x.textContent.trim())) + "; menus: " + document.querySelectorAll('[role="menu"]').length); i.click(); return "picked"; })()`,
    );
  const label = () => app.js<string>(`${switcher}?.getAttribute("aria-label") ?? ""`);
  const editorText = () =>
    app.js<string>(`document.querySelector(".ProseMirror")?.textContent ?? ""`);
  return { manifest, switcher, openSwitcher, pick, label, editorText };
}

async function editionsPart1(ctx: Context) {
  const { app, book, shot, dlg, step } = ctx;
  const { manifest, openSwitcher, pick, label } = editionHelpers(ctx);
  await step(
    "add a French edition: the switcher shows it, its files are written under manuscript/fr, and typing goes to the French file only",
    async () => {
      await openSwitcher();
      await app.sleep(400);
      await pick("Add language");
      await app.sleep(600);
      await dlg(
        `const s = [...d.querySelectorAll("select")].find((e) => [...e.options].some((o) => o.value === "fr")); if (!s) throw new Error("no language select"); s.value = "fr"; s.dispatchEvent(new Event("change", { bubbles: true })); return "fr";`,
      );
      await dlg(
        `const b = [...d.querySelectorAll("button")].find((e) => e.getAttribute("type") === "submit"); b.click(); return "added";`,
      );
      for (let i = 0; i < 20 && !(await label()).includes("Français"); i++) await app.sleep(500);
      assert(
        (await label()).includes("Français"),
        `the switcher did not move to French: ${await label()}`,
      );
      const m = manifest();
      const chapter = m.chapters[0];
      assert(
        m.editions.map((e: { language: string }) => e.language).join() === "en,fr",
        "no fr edition",
      );
      assert(
        chapter.files.fr === chapter.files.en.replace("manuscript/", "manuscript/fr/"),
        "bad fr path",
      );
      const fr = join(book, chapter.files.fr);
      assert(readFileSync(fr, "utf8").length > 0, "the French file was not written by Rust");
      const source = readFileSync(join(book, chapter.files.en), "utf8");
      await app.js(
        `(() => { const ed = document.querySelector('.ProseMirror'); ed.focus(); const s = getSelection(); s.selectAllChildren(ed); s.collapseToEnd(); document.execCommand('insertText', false, ' Bonjour le monde.'); })()`,
      );
      for (let i = 0; i < 20 && !readFileSync(fr, "utf8").includes("Bonjour le monde"); i++)
        await app.sleep(500);
      assert(
        readFileSync(fr, "utf8").includes("Bonjour le monde"),
        "typing did not reach the French file",
      );
      assert(
        readFileSync(join(book, chapter.files.en), "utf8") === source,
        "the source file changed",
      );
      // The page is written first and the manifest (which drops the "untranslated" mark) right after it.
      for (let i = 0; i < 10 && manifest().chapters[0].untranslated; i++) await app.sleep(500);
      assert(!manifest().chapters[0].untranslated, "the chapter is still marked untranslated");
      await shot("08-french-edition");
      return chapter.files.fr;
    },
  );
}

async function editionsPart2(ctx: Context) {
  const { app, book, step, status, runMenu } = ctx;
  const { manifest, openSwitcher, pick, label, editorText } = editionHelpers(ctx);
  await step(
    "switching back shows the source text; an outside edit of the open French file reloads it",
    async () => {
      await openSwitcher();
      await app.sleep(400);
      await pick("English");
      await app.sleep(1200);
      // The English chapter has "Bonjour tout le monde." (marked French by an earlier step), so look for the French edition's own text.
      assert(
        !(await editorText()).includes("Bonjour le monde"),
        "the English page shows French text",
      );
      await openSwitcher();
      await app.sleep(400);
      await pick("Français");
      await app.sleep(1200);
      assert((await editorText()).includes("Bonjour le monde"), "the French page lost its text");
      // A sync folder or another tool rewrites the translation file while it is open.
      const file = join(book, manifest().chapters[0].files.fr);
      const doc = JSON.parse(readFileSync(file, "utf8"));
      doc.content.push({
        type: "paragraph",
        content: [{ type: "text", text: "Ajouté depuis l'extérieur." }],
      });
      writeFileSync(file, JSON.stringify(doc));
      for (let i = 0; i < 20 && !(await editorText()).includes("Ajouté depuis l'extérieur"); i++)
        await app.sleep(500);
      assert(
        (await editorText()).includes("Ajouté depuis l'extérieur"),
        `the outside edit did not show: ${await status()}`,
      );
      await openSwitcher();
      await app.sleep(400);
      await pick("English"); // leave the book in its source edition for the steps after this one
      await app.sleep(1000);
      assert((await label()).includes("English"), "did not return to English");
      return "French reloaded after an outside edit";
    },
  );
  await step(
    "find and replace across editions: All languages rewrites the English and French files, book Undo restores both",
    async () => {
      const m = manifest().chapters[0];
      const read = (lang: string) => readFileSync(join(book, m.files[lang]), "utf8");
      const count = (lang: string, needle: string) => read(lang).split(needle).length - 1;
      const enBefore = count("en", "Bonjour");
      // English (the open edition) gets the word the French page already has.
      await app.js(
        `(() => { const ed = document.querySelector('.ProseMirror'); ed.focus(); const s = getSelection(); s.selectAllChildren(ed); s.collapseToEnd(); document.execCommand('insertText', false, ' Bonjour partout.'); })()`,
      );
      // The English page may already hold "Bonjour" (marked French by an earlier step): wait for the typed one to be saved.
      for (let i = 0; i < 20 && count("en", "Bonjour") <= enBefore; i++) await app.sleep(500);
      const en = count("en", "Bonjour");
      const fr = count("fr", "Bonjour");
      assert(en >= 1 && fr >= 1, `expected Bonjour in both editions (en ${en}, fr ${fr})`);
      await runMenu("edit.find");
      await app.fill(0, "Bonjour");
      await app.click("All chapters");
      await app.click("All languages");
      await app.sleep(900);
      const bar = await app.js<string>(
        `document.querySelector('[aria-label="Find and replace"]').innerText`,
      );
      assert(
        /English: \d+/.test(bar) && /Français: \d+/.test(bar),
        `no per-language counts: ${bar.slice(0, 160)}`,
      );
      await runMenu("edit.findReplace");
      await app.fill(1, "Salut");
      await app.click("Replace all");
      await app.sleep(1500);
      assert(
        count("en", "Bonjour") === 0 && count("fr", "Bonjour") === 0,
        "Replace all did not rewrite both editions",
      );
      assert(
        count("en", "Salut") === en && count("fr", "Salut") === fr,
        `wrong replacement counts: en ${count("en", "Salut")} of ${en}, fr ${count("fr", "Salut")} of ${fr}`,
      );
      await app.js(
        `document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))`,
      );
      await app.sleep(400);
      await runMenu("edit.bookUndo");
      await app.sleep(1500);
      assert(
        count("en", "Bonjour") === en && count("fr", "Bonjour") === fr,
        "book Undo did not restore both editions",
      );
      return `Replaced in en (${en}) and fr (${fr}) with one step; Undo restored both`;
    },
  );
}
