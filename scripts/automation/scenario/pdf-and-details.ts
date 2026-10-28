import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { assert, type Context } from "./context.ts";

export async function pdfAndDetailsSteps({
  app,
  out,
  book,
  dlg,
  exportVia,
  status,
  menuState,
  runMenu,
  step,
}: Context) {
  await step("PDF export with the Modern Memoir template embeds the bundled Inter", async () => {
    await app.click("Export");
    await app.sleep(800);
    await dlg(
      `const o = [...d.querySelectorAll("button,[role=radio]")].find((e) => e.textContent.trim() === "Print PDF"); o.click(); return "picked";`,
    );
    await app.sleep(400);
    await dlg(`const s = [...d.querySelectorAll("select")].find((s) => [...s.options].some((o) => o.textContent === "Modern Memoir")); if (!s) throw new Error("no template select");
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set.call(s, "modern"); s.dispatchEvent(new Event("change", { bubbles: true })); return s.value;`);
    await app.sleep(300);
    await dlg(`d.querySelector('button[type="submit"]').click(); return "submitted";`);
    await app.sleep(1500);
    for (let i = 0; i < 40 && (await app.snapshot()).dialogs.length; i++) await app.sleep(1000);
    const pdf = join(book, "exports/en/book.pdf");
    try {
      const fonts = execFileSync("pdffonts", [pdf], { encoding: "utf8" });
      assert(/\+Inter-/.test(fonts), `Inter is not embedded in the PDF:\n${fonts}`);
      return `embedded: ${[
        ...new Set(
          fonts
            .split("\n")
            .map((l) => /\+(Inter[\w-]*)/.exec(l)?.[1])
            .filter(Boolean),
        ),
      ].join(", ")}`;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT")
        return "exported (poppler not installed, fonts not inspected)";
      throw e;
    }
  });

  await step(
    "menu commands act on the real app: Read, New Chapter and its Undo, Book Details, Settings, Close Project, Open Recent, New Project",
    async () => {
      const chapters = () =>
        JSON.parse(readFileSync(join(book, "cadabra.json"), "utf8")).chapters.length;
      const editable = () =>
        app.js(`document.querySelector(".ProseMirror")?.getAttribute("contenteditable")`);
      const before = chapters();
      await runMenu("view.read");
      assert((await editable()) === "false", "Read did not switch to reading mode");
      let m = await menuState();
      assert(
        m.items.get("view.read")?.checked === true && m.items.get("editor.bold")?.enabled === false,
        "in Read the formatting items should be greyed out and Read ticked",
      );
      await runMenu("view.write");
      assert((await editable()) === "true", "Write did not switch back");
      await runMenu("insert.chapter");
      assert(chapters() === before + 1, "New Chapter did not add a chapter");
      m = await menuState();
      assert(
        /^Undo Add /.test(m.items.get("edit.bookUndo")?.text ?? "") &&
          m.items.get("edit.bookUndo")?.enabled,
        `Undo should name the edit: ${m.items.get("edit.bookUndo")?.text}`,
      );
      await runMenu("edit.bookUndo");
      assert(chapters() === before, "Undo did not remove the chapter");
      await runMenu("file.bookDetails");
      assert(
        (await app.snapshot()).dialogs.some((d) => d.includes("Book details")),
        "Book Details did not open",
      );
      await app.js(
        `document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))`,
      );
      await app.sleep(600);
      await app.click("Cancel").catch(() => {});
      await app.sleep(400);
      await runMenu("app.settings");
      assert((await app.snapshot()).headings.includes("Settings"), "Settings did not open");
      await app.click("Back").catch(() => {});
      await app.sleep(800);
      await runMenu("file.close");
      assert(
        (await app.snapshot()).buttons.includes("New project"),
        "Close Project did not return to the start screen",
      );
      m = await menuState();
      assert(
        m.items.get("file.save")?.enabled === false &&
          m.items.get("file.openRecent:" + book)?.enabled === true,
        "after closing, book actions should be greyed out and the book still in Open Recent",
      );
      await runMenu("file.openRecent", book);
      await app.sleep(1500);
      assert(
        (await app.snapshot()).headings.includes("Scenario Book"),
        "Open Recent did not reopen the book",
      );
      await runMenu("file.new");
      await app.sleep(1200);
      assert(
        (await app.snapshot()).dialogs.some((d) => d.includes("New book")),
        "New Project from inside a book did not show the dialog",
      );
      await app.click("Cancel");
      await app.sleep(500);
      await runMenu("file.openRecent", book);
      await app.sleep(1500);
      assert(
        (await app.snapshot()).headings.includes("Scenario Book"),
        "could not reopen the book",
      );
      return "Read/Write, New Chapter and Undo, Book Details, Settings, Close Project, Open Recent and New Project all acted on the real window";
    },
  );

  await step(
    "find and replace: menu opens the bar, counts matches, replaces all; the book word count shows in the status bar",
    async () => {
      const editorText = () => app.js<string>(`document.querySelector(".ProseMirror").textContent`);
      assert(
        /\d+ in the book/.test(await app.js<string>(`document.body.innerText`)),
        "status bar lacks the whole-book word count",
      );
      await runMenu("edit.find");
      assert(
        await app.js(`!!document.querySelector('[aria-label="Find and replace"]')`),
        "Find did not open the bar",
      );
      await app.fill(0, "agent");
      await app.sleep(500);
      assert(
        /1 of 1/.test(
          await app.js(`document.querySelector('[aria-label="Find and replace"]').innerText`),
        ),
        "the bar does not show 1 of 1",
      );
      await app.click("All chapters");
      await app.sleep(900);
      const bookCount = await app.js<string>(
        `document.querySelector('[aria-label="Find and replace"]').innerText`,
      );
      assert(
        /of 2\b/.test(bookCount),
        `All chapters should also count the author on the title page: ${bookCount.slice(0, 60)}`,
      );
      await app.click("All chapters");
      await app.sleep(500);
      await runMenu("edit.findReplace");
      await app.fill(1, "robot");
      await app.click("Replace all");
      await app.sleep(500);
      const text = await editorText();
      assert(
        text.includes("Typed by an robot.") && !text.includes("agent."),
        `replace all did not change the text: ${text.slice(0, 80)}`,
      );
      await app.js(
        `document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))`,
      );
      await app.sleep(400);
      return "Find opened from the Edit menu, 1 of 1 shown, Replace all changed the real editor text";
    },
  );

  await step(
    "find and replace across chapters: Replace all rewrites other pages on disk, book Undo restores them",
    async () => {
      const pages = () =>
        [join(book, "front-matter"), join(book, "back-matter"), join(book, "manuscript")].flatMap(
          (d) =>
            existsSync(d)
              ? readdirSync(d)
                  .filter((f) => f.endsWith(".json"))
                  .map((f) => join(d, f))
              : [],
        );
      const count = (needle: string) =>
        pages().filter((f) => readFileSync(f, "utf8").includes(needle)).length;
      const before = count("Agent");
      assert(before >= 1, "expected the author name on a front-matter page");
      await runMenu("edit.find");
      await app.fill(0, "Agent");
      await app.click("All chapters");
      await app.sleep(900);
      const rows = await app.js<string>(
        `[...document.querySelectorAll('[aria-label="Find and replace"] button')].map((b) => b.getAttribute("aria-label") ?? "").filter((l) => /match/.test(l)).join("|")`,
      );
      assert(
        /Front matter: .*1 match/.test(rows),
        `the results list should list the title page: ${rows}`,
      );
      await runMenu("edit.findReplace");
      await app.fill(1, "Writer");
      await app.click("Replace all");
      await app.sleep(1500);
      assert(
        count("Agent") === 0 && count("Writer") >= 1,
        `Replace all did not rewrite the pages on disk (Agent in ${count("Agent")}, Writer in ${count("Writer")})`,
      );
      await app.js(
        `document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))`,
      );
      await app.sleep(400);
      await runMenu("edit.bookUndo");
      await app.sleep(1500);
      assert(
        count("Agent") === before && count("Writer") === 0,
        `book Undo did not restore the pages (Agent in ${count("Agent")}, Writer in ${count("Writer")})`,
      );
      return `Replace all changed ${before} page(s) on disk; Undo put them back`;
    },
  );

  await step(
    "find and replace with Regex: capture groups in the replacement, an invalid pattern is refused",
    async () => {
      await runMenu("edit.find");
      await app.fill(0, "(ro)(bot)");
      await app.click("Regex");
      await app.sleep(600);
      const bar = () =>
        app.js<string>(`document.querySelector('[aria-label="Find and replace"]').innerText`);
      assert(
        /1 of 1/.test(await bar()),
        `regex should match "robot": ${(await bar()).slice(0, 60)}`,
      );
      await app.fill(0, "(unclosed");
      await app.sleep(600);
      assert((await bar()).includes("Invalid pattern"), "an invalid pattern should say so");
      await app.fill(0, "(ro)(bot)");
      await runMenu("edit.findReplace");
      await app.fill(1, "$2-$1");
      await app.click("Replace all");
      await app.sleep(600);
      const text = await app.js<string>(`document.querySelector(".ProseMirror").textContent`);
      assert(
        text.includes("Typed by an bot-ro."),
        `capture groups were not applied: ${text.slice(0, 80)}`,
      );
      await app.click("Regex");
      await app.js(
        `document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))`,
      );
      await app.sleep(400);
      return "(ro)(bot) with $2-$1 gave bot-ro; (unclosed shows Invalid pattern";
    },
  );

  await step("pasting HTML text asks, Convert makes real formatting", async () => {
    await app.js(`localStorage.removeItem("cadabracraft.settings")`);
    const paste = (text: string) =>
      app.js(
        `(() => { const ed = document.querySelector('.ProseMirror'); ed.focus(); const dt = new DataTransfer(); dt.setData('text/plain', ${JSON.stringify(text)}); ed.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })); })()`,
      );
    await paste("<p>Gate <b>old</b> <em>tired</em></p>");
    await app.sleep(700);
    assert(
      (await app.snapshot()).dialogs.some((d) => d.includes("Paste as styled text?")),
      "the paste dialog did not open",
    );
    await app.click("Convert");
    await app.sleep(700);
    const html = await app.js<string>(`document.querySelector('.ProseMirror').innerHTML`);
    assert(
      html.includes("<strong>old</strong>") &&
        html.includes("<em>tired</em>") &&
        !html.includes("&lt;b&gt;"),
      `paste was not converted: ${html.slice(-200)}`,
    );
    return "dialog shown, Convert produced strong and em nodes";
  });

  await step("commands refuse a root that is not an existing project", async () => {
    const outcome = (cmd: string, args: unknown) =>
      app.js<string>(
        `window.__TAURI__.core.invoke(${JSON.stringify(cmd)}, ${JSON.stringify(args)}).then((r) => "resolved:" + JSON.stringify(r), (e) => "rejected:" + JSON.stringify(e))`,
      );
    const notProject = join(out, "not-a-project");
    mkdirSync(notProject, { recursive: true });
    for (const [cmd, args] of [
      ["read_project_file", { root: "/", path: "etc/hosts" }],
      ["read_project_file", { root: "relative/book", path: "cadabra.json" }],
      [
        "write_project_file",
        { root: notProject, path: "manuscript/x.json", contents: "{}", baseHash: null },
      ],
      ["write_project_bytes", { root: notProject, path: "exports/x.pdf", bytes: [1] }],
      ["read_asset", { root: notProject, path: "assets/x.png" }],
      ["list_project_trash", { root: notProject }],
    ] as [string, { root: string }][]) {
      const r = await outcome(cmd, args);
      assert(
        r.startsWith("rejected:") && r.includes("not_a_project"),
        `${cmd} on ${args.root}: ${r}`,
      );
    }
    assert(
      !existsSync(join(notProject, "manuscript")) && !existsSync(join(notProject, "exports")),
      "a refused command still wrote into the folder",
    );
    const opening = await outcome("read_project_file", { root: notProject, path: "cadabra.json" });
    assert(
      opening === "resolved:null",
      `opening a folder without a manifest should read as empty, got ${opening}`,
    );
    const real = await outcome("read_project_file", { root: book, path: "cadabra.json" });
    assert(
      real.startsWith("resolved:") && real.includes("Scenario Book"),
      "the real project was refused",
    );
    return "6 commands refused with not_a_project, nothing written; the real project still opens";
  });

  await step("Markdown export writes exports/en/book.md from the Export dialog", async () => {
    await exportVia("Markdown");
    for (let i = 0; i < 20 && !(await status()).includes("exports/en/book.md"); i++)
      await app.sleep(500);
    assert((await status()).includes("exports/en/book.md"), "Markdown export did not finish");
    const md = readFileSync(join(book, "exports/en/book.md"), "utf8");
    assert(
      md.includes("Typed by an bot-ro.") && md.includes("**Bold part.**"),
      `book.md lacks the chapter text: ${md.slice(0, 120)}`,
    );
    await app.js(
      `document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))`,
    );
    await app.sleep(500);
    return "exports/en/book.md has the chapter text with bold written as Markdown";
  });
}
