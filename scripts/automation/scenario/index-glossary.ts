import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { assert, type Context } from "./context.ts";

/** The page helpers the Index and Glossary steps share: they drive the real window's DOM. */
function helpers(app: Context["app"]) {
  /** Types into a React-controlled field: the native setter plus an input event. */
  const typeInto = (selector: string, value: string) =>
    app.js(
      `(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) throw new Error("no field: ${selector}");
      const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, "value").set.call(el, ${JSON.stringify(value)});
      el.dispatchEvent(new Event("input", { bubbles: true })); return "typed"; })()`,
    );
  /** Clicks the visible button (the header has one per breakpoint) with this text or label, inside `scope`. */
  const click = (scope: string, text: string) =>
    app.js(
      `(() => { const b = [...document.querySelectorAll(${JSON.stringify(scope + " button")})].filter((b) => b.offsetParent && (b.textContent.trim() === ${JSON.stringify(text)} || b.getAttribute("aria-label") === ${JSON.stringify(text)})).pop(); if (!b) throw new Error("no control: ${text}"); b.click(); return "clicked"; })()`,
    );
  /** The open dialog whose text starts with `title`. */
  const dialogJs = (title: string) =>
    `[...document.querySelectorAll("[role=dialog]")].find((d) => d.innerText.startsWith(${JSON.stringify(title)}))`;
  const dialogClick = (title: string, text: string) =>
    app.js(
      `(() => { const b = [...${dialogJs(title)}.querySelectorAll("button")].find((b) => b.textContent.trim() === ${JSON.stringify(text)}); if (!b) throw new Error("no button: ${text}"); b.click(); return "clicked"; })()`,
    );
  /** Puts a sentence at the end of the open page and selects `words` in it, the way the mouse would. */
  const selectWords = (words: string) =>
    app.js(
      `(() => { const e = document.querySelector(".ProseMirror").editor;
      if (!e.state.doc.textContent.includes("Magic lived")) { e.commands.focus("end"); e.commands.insertContent(" The orchard wall stood. Magic lived in the orchard."); }
      let at = -1; e.state.doc.descendants((n, p) => { const i = n.isText ? n.text.indexOf(${JSON.stringify(words)}) : -1; if (i >= 0) at = p + i; });
      e.commands.setTextSelection({ from: at, to: at + ${JSON.stringify(words)}.length }); return e.state.doc.textBetween(e.state.selection.from, e.state.selection.to); })()`,
    );
  return { typeInto, click, dialogJs, dialogClick, selectWords };
}

/** The back-of-book index and the glossary, through the real window: panels, dialogs, marks in the chapter file, settings in the manifest. */
export async function indexGlossarySteps({ app, book, shot, step }: Context) {
  const manifest = () => JSON.parse(readFileSync(join(book, "cadabra.json"), "utf8"));
  /** Every chapter file of the book, joined: the open page is whichever the earlier steps left. */
  const chapterText = () =>
    ["manuscript", "front-matter", "back-matter"]
      .flatMap((d) =>
        readdirSync(join(book, d))
          .filter((f) => f.endsWith(".json") && !f.startsWith("."))
          .map((f) => join(book, d, f)),
      )
      .map((f) => readFileSync(f, "utf8"))
      .join("\n");
  /** Waits (the autosave runs a moment after the edit) until the chapter files say `needle`. */
  const onDisk = async (needle: string) => {
    for (let i = 0; i < 20 && !chapterText().includes(needle); i++) await app.sleep(500);
    return chapterText().includes(needle);
  };

  const { typeInto, click, dialogJs, dialogClick, selectWords } = helpers(app);
  const closeSheet = (label: string) =>
    app.js(
      `[...document.querySelectorAll("button")].find((b) => b.getAttribute("aria-label") === ${JSON.stringify(label)})?.click() ?? "none"`,
    );

  await step(
    "index: add an entry from the selection and save the mark in the chapter",
    async () => {
      assert((await selectWords("orchard")) === "orchard", "the words were not selected");
      await click("header", "Index");
      await app.sleep(600);
      await click('section[aria-label="Index"]', "Add selection");
      await app.sleep(600);
      await dialogClick("Index entry", "Add");
      await app.sleep(1500);
      assert(
        (await onDisk('"term": "orchard"')) && chapterText().includes('"indexEntry"'),
        "no indexEntry mark on disk",
      );
      const panelText = await app.js<string>(
        `document.querySelector('section[aria-label="Index"]')?.innerText ?? ""`,
      );
      assert(
        panelText.includes("1 term") && panelText.includes("orchard"),
        "the term is not listed",
      );
      const bar = await app.js<string>(
        `(() => { const m = document.querySelector("[data-index-entry]"); return m ? getComputedStyle(m).boxShadow : "none"; })()`,
      );
      assert(bar !== "none" && bar.includes("inset"), `no bar under the marked words: ${bar}`);
      await shot("14-index-panel");
      return "orchard marked, listed, and drawn with a bar";
    },
  );

  await step("index: settings are saved in the manifest", async () => {
    await click('section[aria-label="Index"]', "Index settings");
    await app.sleep(600);
    await app.js(
      `(() => { const d = ${dialogJs("Index settings")}; const l = [...d.querySelectorAll("label")].find((l) => l.textContent.trim() === "Add an index to the book"); const c = d.querySelector("#" + CSS.escape(l.htmlFor)); if (!c.checked) c.click(); return "on"; })()`,
    );
    await dialogClick("Index settings", "Save");
    await app.sleep(1500);
    const m = manifest();
    assert(
      m.formatVersion === 15 && m.index?.enabled === true,
      `index settings: ${JSON.stringify(m.index)}`,
    );
    await closeSheet("Close index");
    await app.sleep(500);
    return "index.enabled in cadabra.json";
  });

  await step(
    "glossary: add a term with a definition, mark it, save it in the manifest",
    async () => {
      assert((await selectWords("Magic")) === "Magic", "the word was not selected");
      await click("header", "Glossary");
      await app.sleep(600);
      await click('section[aria-label="Glossary"]', "Add term");
      await app.sleep(600);
      await typeInto("[role=dialog] textarea", "What the orchard remembers.");
      await dialogClick("Glossary term", "Add and mark");
      await app.sleep(1500);
      const g = manifest().glossary;
      assert(
        g?.entries?.length === 1 && g.entries[0].definition === "What the orchard remembers.",
        `glossary: ${JSON.stringify(g)}`,
      );
      assert(await onDisk('"glossaryTerm"'), "no glossaryTerm mark on disk");
      const panelText = await app.js<string>(
        `document.querySelector('section[aria-label="Glossary"]')?.innerText ?? ""`,
      );
      assert(panelText.includes("Magic"), `the term is not listed: ${panelText}`);
      await shot("15-glossary-panel");
      await closeSheet("Close glossary");
      return "entry and mark saved, term listed";
    },
  );
}

/** The generated Index and Glossary pages in the back matter, through the real window: read-only pages, kinds in the manifest, the EPUB. */
export async function indexGlossaryPagesSteps({
  app,
  book,
  repo,
  shot,
  step,
  openMenu,
  pickItem,
  exportVia,
}: Context) {
  const manifest = () => JSON.parse(readFileSync(join(book, "cadabra.json"), "utf8"));
  await step(
    "index and glossary pages: add both to the back matter, read them in the page, export the EPUB",
    async () => {
      const kinds = () => manifest().backMatter.map((e: { kind: string }) => e.kind);
      const h1 = () =>
        app.js<string>(`document.querySelector(".ProseMirror h1")?.textContent ?? ""`);
      for (const kind of ["Index", "Glossary"]) {
        await openMenu("Add page");
        await app.sleep(400);
        await pickItem(kind);
        await app.sleep(1500);
        assert((await h1()) === kind, `the ${kind} page did not open: "${await h1()}"`);
        assert(
          (await app.js<string>(
            `document.querySelector(".ProseMirror").getAttribute("contenteditable")`,
          )) === "false",
          `the ${kind} page can be typed into`,
        );
        assert(
          (await app.js<string>(`document.querySelector(".ProseMirror").innerText`)).trim().length >
            kind.length,
          `the ${kind} page shows no list`,
        );
      }
      await shot("16-index-glossary-pages");
      assert(kinds().slice(-2).join() === "index,glossary", `back matter kinds: ${kinds().join()}`);
      const epub = join(book, "exports/en/book.epub");
      rmSync(epub, { force: true });
      await exportVia("EPUB 3");
      for (let i = 0; i < 40 && !existsSync(epub); i++) await app.sleep(1000);
      assert(existsSync(epub), "the EPUB was not written");
      await app.sleep(500);
      const listing = execFileSync("unzip", ["-l", epub], { encoding: "utf8" });
      const ids = manifest()
        .backMatter.filter((e: { kind: string }) => e.kind === "index" || e.kind === "glossary")
        .map((e: { id: string }) => e.id);
      assert(
        ids.every((id: string) => listing.includes(`OEBPS/${id}.xhtml`)) &&
          !listing.includes("generated-index"),
        `the EPUB does not hold the pages in place: ${ids}`,
      );
      // Leave the first chapter open: the next steps type into the open page, and these two cannot be typed into.
      const first = Object.values(manifest().chapters[0].titles)[0] as string;
      await app.js(
        `(() => { const b = [...document.querySelectorAll('nav[aria-label="Chapters"] :is(button, a, [role=button], [role=link], [role=option])')].find((b) => b.textContent.includes(${JSON.stringify(first)})); if (!b) throw new Error("no chapter row: ${first}"); b.click(); return "opened"; })()`,
      );
      await app.sleep(800);
      assert(
        (await app.js<string>(
          `document.querySelector(".ProseMirror").getAttribute("contenteditable")`,
        )) === "true",
        "the first chapter did not open for editing",
      );
      const jar = join(repo, "tools/epubcheck-5.4.0/epubcheck.jar");
      if (!existsSync(jar)) return "exported (EPUBCheck jar not installed, validation skipped)";
      const o = execFileSync("java", ["-jar", jar, epub], { encoding: "utf8" });
      assert(o.includes("No errors or warnings detected"), o.slice(-300));
      return "both pages added, read-only in the page, in the EPUB in place, EPUBCheck clean";
    },
  );
}

/** The native menu accelerators of Index entry and Glossary term, typed through System Events into the real window. */
export async function acceleratorSteps({ app, shot, step }: Context) {
  const { dialogJs, dialogClick, selectWords } = helpers(app);
  /** Brings the app to the front and types a key combination into it through System Events (the OS, not the page). */
  const osKey = (key: string, modifiers: string) => {
    execFileSync(
      "osascript",
      [
        "-e",
        'tell application "System Events" to set frontmost of (first process whose name is "cadabracraft") to true',
        "-e",
        "delay 0.6",
        "-e",
        `tell application "System Events" to keystroke ${JSON.stringify(key)} using {${modifiers}}`,
      ],
      { stdio: "pipe", timeout: 15000 },
    );
  };
  const dialogOpen = (title: string) => app.js<boolean>(`!!${dialogJs(title)}`);

  await step(
    "menu accelerators: Cmd+Alt+X opens Index entry and Cmd+Alt+G opens Glossary term",
    async () => {
      assert((await selectWords("wall")) === "wall", "the word was not selected");
      await app.js(`document.querySelector(".ProseMirror").editor.commands.focus()`);
      osKey("x", "command down, option down");
      await app.sleep(1200);
      assert(await dialogOpen("Index entry"), "Cmd+Alt+X did not open the Index entry dialog");
      await shot("16-accelerator-index-entry");
      await dialogClick("Index entry", "Cancel");
      await app.sleep(600);
      assert(!(await dialogOpen("Index entry")), "the Index entry dialog did not close");
      assert((await selectWords("wall")) === "wall", "the word was not selected again");
      await app.js(`document.querySelector(".ProseMirror").editor.commands.focus()`);
      osKey("g", "command down, option down");
      await app.sleep(1200);
      if (!(await dialogOpen("Glossary term"))) {
        const state = await app.js<string>(
          `JSON.stringify({ dialogs: [...document.querySelectorAll("[role=dialog]")].map((d) => d.innerText.slice(0, 40)), focus: document.hasFocus(), active: document.activeElement?.tagName, selection: document.querySelector(".ProseMirror").editor.state.selection.empty })`,
        );
        assert(false, "Cmd+Alt+G did not open the Glossary term dialog: " + state);
      }
      await shot("17-accelerator-glossary-term");
      await dialogClick("Glossary term", "Cancel");
      await app.sleep(600);
      return "both accelerators reach the app through the native menu";
    },
  );
}
