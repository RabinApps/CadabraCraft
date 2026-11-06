import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { assert, type Context } from "./context.ts";

export async function editingSteps(ctx: Context) {
  await editingPart1(ctx);
  await editingPart2(ctx);
  await editingPart3(ctx);
}

async function editingPart1(ctx: Context) {
  const { app, book, shot, menuState, step } = ctx;
  await step("start screen shows New project, Open folder, Import", async () => {
    // The sponsor dialog after an export would cover the page in every export step; it has its own Playwright tests.
    await app.js("location.reload()").catch(() => {});
    await app.sleep(3000);
    await app.js(`localStorage.setItem("cadabracraft.sponsor", "hidden")`); // read when the page loads, so load it again
    await app.js("location.reload()").catch(() => {});
    await app.sleep(3000);
    const { buttons } = await app.snapshot();
    for (const b of ["New project", "Open folder", "Import…"])
      assert(buttons.includes(b), `missing ${b}`);
    await shot("01-start");
  });

  await step(
    "menu on the start screen: start actions and Settings work, book actions are greyed out",
    async () => {
      const { tops, items } = await menuState();
      assert(
        tops.join(",") === "CadabraCraft,File,Edit,Insert,Format,View,Window,Help",
        `menu bar: ${tops}`,
      );
      for (const id of ["app.settings", "file.new", "file.open", "file.import", "help.sponsor"])
        assert(items.get(id)?.enabled === true, `${id} should be available`);
      for (const id of [
        "file.save",
        "file.bookDetails",
        "file.exportEpub",
        "file.close",
        "insert.chapter",
        "view.read",
        "editor.bold",
        "go.next",
      ])
        assert(items.get(id)?.enabled === false, `${id} should be greyed out`);
      assert(items.get("app.settings")?.accelerator === "CmdOrCtrl+,", "Settings has no shortcut");
      return `${tops.length} menus; Settings under CadabraCraft`;
    },
  );

  await step("create a project through the real dialogs and Rust commands", async () => {
    await app.queueDialogs([book]);
    await app.click("New project");
    await app.sleep(500);
    await app.click("Choose…");
    await app.sleep(500);
    await app.fill(0, "Scenario Book");
    await app.fill(1, "Agent");
    await app.click("Create book");
    await app.sleep(3000);
    const s = await app.snapshot();
    assert(
      s.headings.includes("Scenario Book") && s.headings.includes("Chapter One"),
      "project did not open",
    );
    const manifest = JSON.parse(readFileSync(join(book, "cadabra.json"), "utf8"));
    assert(
      manifest.editions[0].title === "Scenario Book" && manifest.chapters.length === 1,
      "manifest wrong",
    );
    await shot("02-created");
  });

  await step("type, bold, scene break and footnote reach the editor", async () => {
    await app.js(
      `(() => { const ed = document.querySelector('.ProseMirror'); ed.focus(); const s = getSelection(); s.selectAllChildren(ed); s.collapseToEnd(); document.execCommand('insertText', false, 'Typed by an agent. '); })()`,
    );
    await app.click("Bold");
    await app.js(`document.execCommand('insertText', false, 'Bold part.')`);
    await app.click("Scene break");
    await app.click("Footnote");
    const html = await app.js<string>(`document.querySelector('.ProseMirror').innerHTML`);
    for (const needle of [
      "Typed by an agent.",
      "<strong>Bold part.</strong>",
      "scene-break",
      'class="footnote"',
    ])
      assert(html.includes(needle), `editor lacks ${needle}`);
  });
}

async function editingPart2(ctx: Context) {
  const { app, book, png, out, repo, shot, menuState, step } = ctx;
  await step(
    "menu in a book: book actions and formatting are available, the current mode is ticked",
    async () => {
      const { items } = await menuState();
      for (const id of [
        "file.save",
        "file.bookDetails",
        "file.exportEpub",
        "file.exportPdf",
        "file.printPreview",
        "file.close",
        "insert.chapter",
        "view.read",
        "view.focus",
        "editor.bold",
        "editor.sceneBreak",
      ]) {
        assert(items.get(id)?.enabled === true, `${id} should be available in a book`);
      }
      assert(
        items.get("view.write")?.checked === true && items.get("view.read")?.checked === false,
        "Write should be ticked",
      );
      assert(
        items.get("file.openRecent:" + book)?.text === "Scenario Book",
        "the open book is not in Open Recent",
      );
      return "book actions available; Write ticked; the book is listed in Open Recent";
    },
  );

  await step("autosave writes the typed text to disk without pressing Save", async () => {
    await app.sleep(3500); // AUTOSAVE_MS is 2 s
    const dir = join(book, "manuscript");
    const files = readdirSync(dir).filter((f) => f.endsWith(".json"));
    assert(
      files.some((f) => readFileSync(join(dir, f), "utf8").includes("Typed by an agent.")),
      "typed text not on disk after the autosave delay",
    );
    return "chapter file contains the typed text";
  });

  await step(
    "image: queued picker, import into assets/, rendered from the real read_asset",
    async () => {
      await app.queueDialogs([png]);
      await app.click("Image");
      await app.sleep(1000);
      await app.fill(1, "A pixel");
      await app.fill(2, "Figure 1");
      await app.click("Insert");
      await app.sleep(2000);
      assert(existsSync(join(book, "assets/pixel.png")), "asset not copied");
      const loaded = await app.js(
        `(() => { const i = document.querySelector('.ProseMirror img'); return !!i && i.complete && i.naturalWidth > 0; })()`,
      );
      assert(loaded === true, "image did not render");
      await shot("03-image");
    },
  );

  await step(
    "pickers run in Rust: a path nobody picked is refused by create_project, import_asset and read_import_source",
    async () => {
      const call = (cmd: string, args: unknown) =>
        app.js<string>(
          `window.__TAURI__.core.invoke(${JSON.stringify(cmd)}, ${JSON.stringify(args)}).then(() => "accepted", (e) => (e && e.kind) || String(e))`,
        );
      const stranger = join(out, "never-picked");
      mkdirSync(stranger, { recursive: true });
      writeFileSync(join(stranger, "x.md"), "# not picked\n");
      writeFileSync(join(stranger, "x.png"), readFileSync(png));
      assert(
        (await call("create_project", { root: stranger, manifestJson: "{}" })) === "not_picked",
        "create_project accepted a folder nobody picked",
      );
      assert(
        (await call("import_asset", { root: book, source: join(stranger, "x.png") })) ===
          "not_picked",
        "import_asset accepted an image nobody picked",
      );
      assert(
        (await call("read_import_source", { path: join(stranger, "x.md") })) === "not_picked",
        "read_import_source accepted a document nobody picked",
      );
      assert(
        (await call("read_import_source", { path: join(repo, "package.json") })) === "not_picked",
        "read_import_source accepted a file elsewhere on the disk",
      );
    },
  );
}

async function editingPart3(ctx: Context) {
  const { app, book, shot, dlg, runMenu, step } = ctx;
  await step(
    "strikethrough, code block and table: menu commands reach the editor and the chapter file",
    async () => {
      const editorHtml = () => app.js<string>(`document.querySelector('.ProseMirror').innerHTML`);
      const key = (k: string) =>
        app.js(
          `(() => { const ed = document.querySelector('.ProseMirror'); ed.focus(); for (const type of ["keydown", "keyup"]) ed.dispatchEvent(new KeyboardEvent(type, { key: ${JSON.stringify(k)}, code: ${JSON.stringify(k)}, keyCode: ${k === "Tab" ? 9 : 13}, bubbles: true, cancelable: true })); })()`,
        );
      const type = (text: string) =>
        app.js(`document.execCommand('insertText', false, ${JSON.stringify(text)})`);
      const toEnd = () =>
        app.js(
          `(() => { const ed = document.querySelector('.ProseMirror'); ed.focus(); const s = getSelection(); s.selectAllChildren(ed); s.collapseToEnd(); })()`,
        );
      const chapterJson = () => {
        const dir = join(book, "manuscript");
        return (
          readdirSync(dir)
            .filter((f) => f.endsWith(".json"))
            .map((f) => readFileSync(join(dir, f), "utf8"))
            .find((t) => t.includes("Typed by an agent.")) ?? ""
        );
      };
      await toEnd();
      await key("Enter");
      await runMenu("editor.strike");
      await type("Struck out.");
      await runMenu("editor.strike");
      assert(
        (await editorHtml()).includes("<s>Struck out.</s>"),
        "strikethrough did not reach the editor",
      );
      await key("Enter");
      await runMenu("editor.codeBlock");
      await type("let x = 1 < 2;");
      assert(
        /<pre[^>]*><code>let x = 1 &lt; 2;<\/code><\/pre>/.test(await editorHtml()),
        "code block did not reach the editor",
      );
      await key("Enter");
      await key("Enter");
      await key("Enter"); // a third Enter leaves the code block
      await type("After code.");
      await key("Enter");
      await runMenu("editor.table");
      await dlg(`d.querySelector('button[type="submit"]').click(); return "submitted";`);
      await app.sleep(600);
      assert(
        (await app.js(`document.querySelectorAll('.ProseMirror table').length`)) === 1,
        "table did not reach the editor",
      );
      await type("Item");
      await key("Tab");
      await type("Cost & note");
      await key("Tab");
      await type("a<b");
      const html = await editorHtml();
      for (const needle of ["<th", "Item", "Cost &amp; note", "a&lt;b"])
        assert(html.includes(needle), `table lacks ${needle}`);
      await shot("03b-marks-code-table");
      await app.sleep(3500); // autosave
      const json = chapterJson();
      for (const needle of [
        '"type":"strike"',
        '"type":"codeBlock"',
        "let x = 1 < 2;",
        '"type":"table"',
        '"type":"tableHeader"',
        '"type":"tableCell"',
        "Cost & note",
        "a<b",
      ]) {
        assert(
          json.replace(/\s/g, "").includes(needle.replace(/\s/g, "")) || json.includes(needle),
          `chapter file lacks ${needle}`,
        );
      }
      assert(
        !json.includes("<s>") && !json.includes("<table"),
        "the chapter file must hold JSON, never HTML",
      );
      return "strike, codeBlock, table, tableHeader and tableCell are in the chapter JSON";
    },
  );
}
