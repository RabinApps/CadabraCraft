import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { assert, type Context } from "./context.ts";

export async function importAndCloseSteps(ctx: Context) {
  await importAndClosePart1(ctx);
  await importAndClosePart2(ctx);
}

async function importAndClosePart1(ctx: Context) {
  const { app, imported, src, importedDocx, docxBefore, mdBefore, shot, dlg, step } = ctx;
  await step(
    "import Markdown into a new project; source untouched; warnings reported",
    async () => {
      await app.js("location.reload()").catch(() => {});
      await app.sleep(3000);
      await app.queueDialogs([join(src, "book.md"), imported]);
      await app.click("Import…");
      await app.sleep(800);
      await app.click("Choose file…");
      await app.sleep(500);
      await app.click("Choose…");
      await app.sleep(500);
      await app.click("Next");
      await app.sleep(1000);
      await app.click("Import");
      await app.sleep(4000);
      const s = await app.snapshot();
      assert(
        s.dialogs.some((d) => d.includes("Imported 2 chapters") && d.includes("Raw HTML")),
        "report missing or wrong",
      );
      assert(readFileSync(join(src, "book.md"), "utf8") === mdBefore, "source file was modified");
      assert(existsSync(join(imported, "manuscript/002-second.json")), "chapter files missing");
      await shot("04-import-report");
    },
  );

  await step(
    "import a real .docx through the wizard: preview, rename, skip; source untouched",
    async () => {
      await app.click("Done").catch(() => {});
      await app.sleep(500);
      await app.js("location.reload()").catch(() => {});
      await app.sleep(3000);
      await app.queueDialogs([join(src, "book.docx"), importedDocx]);
      await app.click("Import…");
      await app.sleep(800);
      await app.click("Choose file…");
      await app.sleep(500);
      await app.click("Choose…");
      await app.sleep(500);
      await app.click("Next");
      await app.sleep(1500);
      const prev = await app.snapshot();
      assert(
        JSON.stringify(prev).includes("Title of chapter 2"),
        "preview step with chapter rows not shown",
      );
      assert(
        !existsSync(join(importedDocx, "cadabra.json")),
        "something was written before Import",
      );
      await shot("05-import-preview");
      await dlg(
        `const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set; const i = d.querySelector('input[aria-label="Title of chapter 1"]'); set.call(i, "Prologue"); i.dispatchEvent(new Event("input", { bubbles: true })); return "renamed";`,
      );
      await dlg(
        `d.querySelector('input[aria-label="Include chapter 2"]').click(); return "skipped";`,
      );
      await app.sleep(300);
      await app.click("Import");
      await app.sleep(4000);
      const s = await app.snapshot();
      assert(
        s.dialogs.some((d) => d.includes("Imported 1 chapter")),
        "report missing or wrong chapter count",
      );
      assert(readFileSync(join(src, "book.docx")).equals(docxBefore), "source .docx was modified");
      const files = readdirSync(join(importedDocx, "manuscript"));
      assert(files.length === 1, `expected 1 chapter file, got ${files.join(",")}`);
      assert(
        readFileSync(join(importedDocx, "manuscript", files[0] ?? ""), "utf8").includes(
          "First chapter text",
        ),
        "chapter text missing",
      );
      assert(
        readFileSync(join(importedDocx, "cadabra.json"), "utf8").includes("Prologue"),
        "rename not in manifest",
      );
      assert(
        !readFileSync(join(importedDocx, "cadabra.json"), "utf8").includes("Dusk"),
        "skipped chapter listed",
      );
      await shot("06-import-docx-report");
    },
  );
}

async function importAndClosePart2(ctx: Context) {
  const { app, imported, src, importedHtml, shot, exportVia, step } = ctx;
  await step(
    "import a real .html file through the wizard; scripts never reach the chapter",
    async () => {
      await app.click("Done").catch(() => {});
      await app.sleep(500);
      await app.js("location.reload()").catch(() => {});
      await app.sleep(3000);
      await app.queueDialogs([join(src, "page.html"), importedHtml]);
      await app.click("Import…");
      await app.sleep(800);
      await app.click("Choose file…");
      await app.sleep(500);
      await app.click("Choose…");
      await app.sleep(500);
      await app.click("Next");
      await app.sleep(1500);
      await app.click("Import");
      await app.sleep(4000);
      const files = readdirSync(join(importedHtml, "manuscript"));
      assert(files.length === 1, `expected 1 chapter file, got ${files.join(",")}`);
      const json = readFileSync(join(importedHtml, "manuscript", files[0] ?? ""), "utf8");
      assert(
        json.includes("The gate was") && json.includes('"bold"') && json.includes('"underline"'),
        "styled text missing from the chapter",
      );
      assert(
        !json.includes("alert(1)") && !json.includes("<b>"),
        "script text or raw tags reached the chapter",
      );
      return "heading, bold and underline imported; script dropped";
    },
  );

  await step(
    "sponsor dialog: appears after an export, Sponsor is the only address the opener may open",
    async () => {
      await app.js(`localStorage.removeItem("cadabracraft.sponsor")`);
      await app.js("location.reload()").catch(() => {});
      await app.sleep(3000);
      await app.queueDialogs([imported]);
      await app.click("Open folder");
      await app.sleep(2500);
      await exportVia("EPUB 3");
      for (
        let i = 0;
        i < 20 && !(await app.snapshot()).dialogs.some((d) => d.includes("Enjoying CadabraCraft?"));
        i++
      )
        await app.sleep(500);
      const dialogs = (await app.snapshot()).dialogs;
      assert(
        dialogs.some(
          (d) =>
            d.includes("Enjoying CadabraCraft?") && d.includes("Exported exports/en/book.epub"),
        ),
        `no sponsor dialog: ${JSON.stringify(dialogs)}`,
      );
      const { buttons } = await app.snapshot();
      for (const b of ["Don't show again", "Maybe later", "Sponsor"])
        assert(buttons.includes(b), `missing ${b}`);
      await shot("06-sponsor");
      // The capability allows exactly the sponsor page: any other address must be refused before a browser opens.
      const refused = await app.js(
        `window.__TAURI__.core.invoke("plugin:opener|open_url", { url: "https://example.com/" }).then(() => "opened", (e) => "refused:" + String(e))`,
      );
      assert(
        String(refused).startsWith("refused:"),
        `the opener opened a page outside its scope: ${refused}`,
      );
      await app.click("Maybe later");
      await app.sleep(600);
      assert(
        !(await app.snapshot()).dialogs.some((d) => d.includes("Enjoying CadabraCraft?")),
        "Maybe later did not close the dialog",
      );
      return `dialog shown after the export; example.com refused (${String(refused).slice(0, 60)})`;
    },
  );

  await step("closing the window right after typing saves the text first", async () => {
    await app.click("Done").catch(() => {});
    await app.sleep(800); // the import report, when still open, would hold the focus
    await app.js(
      `(() => { const ed = document.querySelector('.ProseMirror'); ed.focus(); const s = getSelection(); s.selectAllChildren(ed); s.collapseToEnd(); document.execCommand('insertText', false, ' Typed just before closing.'); })()`,
    );
    const dir = join(imported, "manuscript");
    const holds = () =>
      readdirSync(dir).some((f) =>
        readFileSync(join(dir, f), "utf8").includes("Typed just before closing."),
      );
    assert(!holds(), "autosave already ran, so this would not test the close path");
    // Closing is asynchronous in the app (it waits for the save), so the call may not return before the window is gone.
    await app.js(`window.__TAURI__.window.getCurrentWindow().close()`).catch(() => {});
    for (let i = 0; i < 10 && !holds(); i++) await app.sleep(500);
    assert(holds(), "the text typed within the autosave delay was lost when the window closed");
    return "chapter file has the text typed less than a second before closing";
  });
}
