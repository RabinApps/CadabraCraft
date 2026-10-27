#!/usr/bin/env node
// End-to-end click-through of the REAL desktop app (create, edit, image, EPUB, PDF, import) with assertions.
// Usage: node scripts/automation/scenario.ts [--launch] [--out <dir>]
//   --launch  start `pnpm tauri:automate` first (waits for the bridge) and stop it afterwards
//   --out     where to put the scratch books and screenshots (default: a new temp dir)
import { spawn, execFileSync, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { connect, type App } from "./client.ts";
import { tinyDocx } from "../../apps/desktop/e2e/fixtures.ts";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const args = process.argv.slice(2);
const out = args.includes("--out") ? resolve(args[args.indexOf("--out") + 1] ?? ".") : mkdtempSync(join(tmpdir(), "cadabra-scenario-"));
mkdirSync(out, { recursive: true });

const results: { name: string; ok: boolean; detail?: string | void }[] = [];
const step = async (name: string, fn: () => Promise<string | void>) => {
  try {
    const detail = await fn();
    results.push({ name, ok: true, detail });
    console.log(`PASS ${name}${detail ? ` - ${detail}` : ""}`);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    results.push({ name, ok: false, detail: message });
    console.log(`FAIL ${name} - ${message}`);
    throw e;
  }
};
const assert: (cond: unknown, msg: string) => asserts cond = (cond, msg) => { if (!cond) throw new Error(msg); };

let launched: App | undefined;
let child: ChildProcess | undefined;
if (args.includes("--launch")) {
  child = spawn("pnpm", ["--filter", "@cadabracraft/desktop", "tauri:automate"], { cwd: repo, stdio: "ignore", detached: true });
  for (let i = 0; i < 90; i++) {
    try { launched = await connect({ timeoutMs: 30000 }); break; } catch { await new Promise((r) => setTimeout(r, 2000)); }
  }
}
const app: App = launched ?? await connect();

const book = join(out, "book"), imported = join(out, "imported"), src = join(out, "src");
for (const d of [book, imported, src]) mkdirSync(d, { recursive: true });
writeFileSync(join(src, "book.md"), "# First\n\nHello *world*[^1].\n\n<div>raw</div>\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n# Second\n\nMore.\n\n[^1]: Note.\n");
writeFileSync(join(src, "book.docx"), tinyDocx({ image: true }));
const docxBefore = readFileSync(join(src, "book.docx"));
const importedDocx = join(out, "imported-docx");
mkdirSync(importedDocx, { recursive: true });
const mdBefore = readFileSync(join(src, "book.md"), "utf8");
const png = join(repo, "fixtures/assets/pixel.png");
const shot = (n: string) => app.screenshot(join(out, `${n}.png`));
// Radix menus open on pointerdown, so a plain click() is not enough for the trigger; items react to click().
const openMenu = (label: string) => app.js(`(() => { const b = [...document.querySelectorAll("button")].find((b) => (b.textContent.trim() || b.getAttribute("aria-label")) === ${JSON.stringify(label)});
  if (!b) throw new Error("no button: ${label}"); b.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0, pointerType: "mouse" })); return "opened"; })()`);
const pickItem = (label: string) => app.js(`(() => { const i = [...document.querySelectorAll('[role="menuitem"]')].find((i) => i.textContent.trim() === ${JSON.stringify(label)});
  if (!i) throw new Error("no menu item: ${label}"); i.click(); return "picked"; })()`);
// The Export dialog (M2): the header button opens it, a Format control picks EPUB or PDF, the dialog's submit button runs it.
const dlg = (body: string) => app.js(`(() => { const d = document.querySelector('[role="dialog"]'); if (!d) throw new Error("no dialog"); ${body} })()`);
const exportVia = async (format: string) => {
  await app.click("Export"); await app.sleep(800);
  await dlg(`const o = [...d.querySelectorAll("button,[role=radio]")].find((e) => e.textContent.trim() === ${JSON.stringify(format)}); if (!o) throw new Error("no format: ${format}"); o.click(); return "picked";`);
  await app.sleep(300);
  await dlg(`d.querySelector('button[type="submit"]').click(); return "submitted";`);
};
const status = async () => (await app.snapshot()).status.join(" ");
// The native menu cannot be clicked from outside, so dev builds publish what it was told to show and a way to run its commands.
const menuState = async () => {
  const m = JSON.parse(await app.js(`JSON.stringify(window.__cadabraMenu ? { error: window.__cadabraMenu.error, model: window.__cadabraMenu.model } : null)`));
  assert(m, "the app did not publish its menu");
  assert(m.error === null, `the system refused the menu: ${m.error}`);
  type MenuEntry = { kind: string; id: string; arg?: string; text: string; enabled: boolean; checked?: boolean; accelerator?: string; items: MenuEntry[] };
  const items = new Map<string, MenuEntry>();
  const walk = (entries: MenuEntry[]) => { for (const e of entries) { if (e.kind === "command") items.set(e.arg === undefined ? e.id : `${e.id}:${e.arg}`, e); else if (e.kind === "submenu") walk(e.items); } };
  walk(m.model);
  return { tops: (m.model as MenuEntry[]).filter((e) => e.kind === "submenu").map((e) => e.text), items };
};
const runMenu = async (id: string, arg?: string) => { const ran = await app.js(`window.__cadabraMenu.run(${JSON.stringify(id)}, ${JSON.stringify(arg)})`); if (ran !== true) { const why = await app.js(`JSON.stringify({ dialogs: [...document.querySelectorAll("[role=dialog]")].map((d) => d.textContent.slice(0, 80)), headings: [...document.querySelectorAll("h1,h2")].map((h) => h.textContent) })`); assert(false, `menu command ${id} did not run: ${why}`); } await app.sleep(900); };


try {
  await step("start screen shows New project, Open folder, Import", async () => {
    // The sponsor dialog after an export would cover the page in every export step; it has its own Playwright tests.
    await app.js("location.reload()").catch(() => {});
    await app.sleep(3000);
    await app.js(`localStorage.setItem("cadabracraft.sponsor", "hidden")`); // read when the page loads, so load it again
    await app.js("location.reload()").catch(() => {});
    await app.sleep(3000);
    const { buttons } = await app.snapshot();
    for (const b of ["New project", "Open folder", "Import…"]) assert(buttons.includes(b), `missing ${b}`);
    await shot("01-start");
  });

  await step("menu on the start screen: start actions and Settings work, book actions are greyed out", async () => {
    const { tops, items } = await menuState();
    assert(tops.join(",") === "CadabraCraft,File,Edit,Insert,Format,View,Window,Help", `menu bar: ${tops}`);
    for (const id of ["app.settings", "file.new", "file.open", "file.import", "help.sponsor"]) assert(items.get(id)?.enabled === true, `${id} should be available`);
    for (const id of ["file.save", "file.bookDetails", "file.exportEpub", "file.close", "insert.chapter", "view.read", "editor.bold", "go.next"]) assert(items.get(id)?.enabled === false, `${id} should be greyed out`);
    assert(items.get("app.settings")?.accelerator === "CmdOrCtrl+,", "Settings has no shortcut");
    return `${tops.length} menus; Settings under CadabraCraft`;
  });

  await step("create a project through the real dialogs and Rust commands", async () => {
    await app.queueDialogs([book]);
    await app.click("New project"); await app.sleep(500);
    await app.click("Choose…"); await app.sleep(500);
    await app.fill(0, "Scenario Book"); await app.fill(1, "Agent");
    await app.click("Create book"); await app.sleep(3000);
    const s = await app.snapshot();
    assert(s.headings.includes("Scenario Book") && s.headings.includes("Chapter One"), "project did not open");
    const manifest = JSON.parse(readFileSync(join(book, "cadabra.json"), "utf8"));
    assert(manifest.title === "Scenario Book" && manifest.chapters.length === 1, "manifest wrong");
    await shot("02-created");
  });

  await step("type, bold, scene break and footnote reach the editor", async () => {
    await app.js(`(() => { const ed = document.querySelector('.ProseMirror'); ed.focus(); const s = getSelection(); s.selectAllChildren(ed); s.collapseToEnd(); document.execCommand('insertText', false, 'Typed by an agent. '); })()`);
    await app.click("Bold");
    await app.js(`document.execCommand('insertText', false, 'Bold part.')`);
    await app.click("Scene break"); await app.click("Footnote");
    const html = await app.js(`document.querySelector('.ProseMirror').innerHTML`);
    for (const needle of ["Typed by an agent.", "<strong>Bold part.</strong>", "scene-break", 'class="footnote"']) assert(html.includes(needle), `editor lacks ${needle}`);
  });

  await step("menu in a book: book actions and formatting are available, the current mode is ticked", async () => {
    const { items } = await menuState();
    for (const id of ["file.save", "file.bookDetails", "file.exportEpub", "file.exportPdf", "file.printPreview", "file.close", "insert.chapter", "view.read", "view.focus", "editor.bold", "editor.sceneBreak"]) {
      assert(items.get(id)?.enabled === true, `${id} should be available in a book`);
    }
    assert(items.get("view.write")?.checked === true && items.get("view.read")?.checked === false, "Write should be ticked");
    assert(items.get("file.openRecent:" + book)?.text === "Scenario Book", "the open book is not in Open Recent");
    return "book actions available; Write ticked; the book is listed in Open Recent";
  });

  await step("autosave writes the typed text to disk without pressing Save", async () => {
    await app.sleep(3500); // AUTOSAVE_MS is 2 s
    const dir = join(book, "manuscript");
    const files = readdirSync(dir).filter((f) => f.endsWith(".json"));
    assert(files.some((f) => readFileSync(join(dir, f), "utf8").includes("Typed by an agent.")), "typed text not on disk after the autosave delay");
    return "chapter file contains the typed text";
  });

  await step("image: queued picker, import into assets/, rendered from the real read_asset", async () => {
    await app.queueDialogs([png]);
    await app.click("Image"); await app.sleep(1000);
    await app.fill(1, "A pixel"); await app.fill(2, "Figure 1");
    await app.click("Insert"); await app.sleep(2000);
    assert(existsSync(join(book, "assets/pixel.png")), "asset not copied");
    const loaded = await app.js(`(() => { const i = document.querySelector('.ProseMirror img'); return !!i && i.complete && i.naturalWidth > 0; })()`);
    assert(loaded === true, "image did not render");
    await shot("03-image");
  });

  await step("strikethrough, code block and table: menu commands reach the editor and the chapter file", async () => {
    const editorHtml = () => app.js(`document.querySelector('.ProseMirror').innerHTML`);
    const key = (k: string) => app.js(`(() => { const ed = document.querySelector('.ProseMirror'); ed.focus(); for (const type of ["keydown", "keyup"]) ed.dispatchEvent(new KeyboardEvent(type, { key: ${JSON.stringify(k)}, code: ${JSON.stringify(k)}, keyCode: ${k === "Tab" ? 9 : 13}, bubbles: true, cancelable: true })); })()`);
    const type = (text: string) => app.js(`document.execCommand('insertText', false, ${JSON.stringify(text)})`);
    const toEnd = () => app.js(`(() => { const ed = document.querySelector('.ProseMirror'); ed.focus(); const s = getSelection(); s.selectAllChildren(ed); s.collapseToEnd(); })()`);
    const chapterJson = () => {
      const dir = join(book, "manuscript");
      return readdirSync(dir).filter((f) => f.endsWith(".json")).map((f) => readFileSync(join(dir, f), "utf8")).find((t) => t.includes("Typed by an agent.")) ?? "";
    };
    await toEnd(); await key("Enter");
    await runMenu("editor.strike"); await type("Struck out."); await runMenu("editor.strike");
    assert((await editorHtml()).includes("<s>Struck out.</s>"), "strikethrough did not reach the editor");
    await key("Enter"); await runMenu("editor.codeBlock"); await type("let x = 1 < 2;");
    assert((await editorHtml()).includes("<pre><code>let x = 1 &lt; 2;</code></pre>"), "code block did not reach the editor");
    await key("Enter"); await key("Enter"); await key("Enter"); // a third Enter leaves the code block
    await type("After code.");
    await key("Enter");
    await runMenu("editor.table");
    await dlg(`d.querySelector('button[type="submit"]').click(); return "submitted";`); await app.sleep(600);
    assert((await app.js(`document.querySelectorAll('.ProseMirror table').length`)) === 1, "table did not reach the editor");
    await type("Item"); await key("Tab"); await type("Cost & note"); await key("Tab"); await type("a<b");
    const html = await editorHtml();
    for (const needle of ["<th", "Item", "Cost &amp; note", "a&lt;b"]) assert(html.includes(needle), `table lacks ${needle}`);
    await shot("03b-marks-code-table");
    await app.sleep(3500); // autosave
    const json = chapterJson();
    for (const needle of ['"type":"strike"', '"type":"codeBlock"', "let x = 1 < 2;", '"type":"table"', '"type":"tableHeader"', '"type":"tableCell"', "Cost & note", "a<b"]) {
      assert(json.replace(/\s/g, "").includes(needle.replace(/\s/g, "")) || json.includes(needle), `chapter file lacks ${needle}`);
    }
    assert(!json.includes("<s>") && !json.includes("<table"), "the chapter file must hold JSON, never HTML");
    return "strike, codeBlock, table, tableHeader and tableCell are in the chapter JSON";
  });

  await step("add a title page and a back-matter page through the Add page menu", async () => {
    await openMenu("Add page"); await app.sleep(400);
    await pickItem("Title page"); await app.sleep(1500);
    const editorH1 = () => app.js(`document.querySelector(".ProseMirror h1")?.textContent ?? ""`);
    assert((await editorH1()) === "Scenario Book" && (await app.js(`document.querySelector(".ProseMirror").textContent`)).includes("Agent"), "title page did not open in the editor");
    await openMenu("Add page"); await app.sleep(400);
    await pickItem("About the author"); await app.sleep(1500);
    assert((await editorH1()) === "About the Author", "about-the-author page did not open");
    const manifest = JSON.parse(readFileSync(join(book, "cadabra.json"), "utf8"));
    assert(manifest.formatVersion === 3, "manifest is not format 3");
    assert(manifest.frontMatter[0]?.kind === "title-page" && manifest.backMatter[0]?.kind === "about-the-author", "kinds missing in the manifest");
    assert(existsSync(join(book, "front-matter/01-title-page.json")) && existsSync(join(book, "back-matter/01-about-the-author.json")), "matter files not written by Rust");
    assert(readFileSync(join(book, "front-matter/01-title-page.json"), "utf8").includes("Agent"), "title page lacks the author");
    await shot("03b-matter");
    return "front-matter/01-title-page.json, back-matter/01-about-the-author.json";
  });

  await step("EPUB export passes EPUBCheck and contains the matter pages", async () => {
    await exportVia("EPUB 3");
    for (let i = 0; i < 15 && !(await status()).includes("exports/book.epub"); i++) await app.sleep(1000);
    assert((await status()).includes("exports/book.epub"), "no export notice");
    const listing = execFileSync("unzip", ["-l", join(book, "exports/book.epub")], { encoding: "utf8" });
    assert(listing.includes("OEBPS/fm-1.xhtml") && listing.includes("OEBPS/bm-1.xhtml"), "EPUB lacks the matter pages");
    const titleXhtml = execFileSync("unzip", ["-p", join(book, "exports/book.epub"), "OEBPS/fm-1.xhtml"], { encoding: "utf8" });
    assert(titleXhtml.includes('epub:type="frontmatter titlepage"'), "title page lacks epub:type");
    const jar = join(repo, "tools/epubcheck-5.4.0/epubcheck.jar");
    if (!existsSync(jar)) return "exported (EPUBCheck jar not installed, validation skipped)";
    const o = execFileSync("java", ["-jar", jar, join(book, "exports/book.epub")], { encoding: "utf8" });
    assert(o.includes("No errors or warnings detected"), o.slice(-300));
    return "EPUBCheck: 0 errors, 0 warnings";
  });

  await step("PDF export produces a 6x9 PDF with embedded fonts", async () => {
    await exportVia("Print PDF"); await app.sleep(1000);
    for (let i = 0; i < 40 && !(await status()).includes("exports/book.pdf"); i++) await app.sleep(1000);
    assert((await status()).includes("exports/book.pdf"), "PDF export did not finish (is Typst installed?)");
    const pdf = join(book, "exports/book.pdf");
    try {
      const info = execFileSync("pdfinfo", [pdf], { encoding: "utf8" });
      assert(/Page size:\s+432 x 648/.test(info), "wrong page size");
      const pages = execFileSync("pdftotext", ["-layout", pdf, "-"], { encoding: "utf8" }).split("\f");
      assert(pages[0]?.includes("Scenario Book") && pages[0]?.includes("Agent"), "title page is not first");
      assert(pages.some((p) => p.includes("About the Author")), "back matter missing from the PDF");
      assert(pages.findIndex((p) => p.includes("Typed by an agent")) < pages.findIndex((p) => p.includes("About the Author")), "back matter is not after the chapters");
      return "432x648 pt (6x9 in), title page first, about-the-author last";
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return "exported (poppler not installed, not inspected)";
      throw e;
    }
  });

  await step("Book details: set ISBN and a cover through the real picker, saved to cadabra.json", async () => {
    await app.click("Book details"); await app.sleep(800);
    assert((await app.snapshot()).dialogs.some((d) => d.includes("Book details")), "dialog did not open");
    await app.js(`(() => { const d = document.querySelector('[role="dialog"]'); const i = [...d.querySelectorAll("input")].find((e) => e.id && d.querySelector("label[for=\\"" + e.id + "\\"]")?.textContent === "ISBN"); if (!i) throw new Error("no ISBN field");
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(i, "978-3-16-148410-0"); i.dispatchEvent(new Event("input", { bubbles: true })); return "filled"; })()`);
    await app.queueDialogs([png]);
    await dlg(`[...d.querySelectorAll("button")].find((b) => b.textContent.trim() === "Choose image…").click(); return "choosing";`);
    await app.sleep(1500);
    const shown = await dlg(`const i = d.querySelector('img[alt="Cover preview"]'); return !!i && i.complete && i.naturalWidth > 0;`);
    assert(shown === true, "cover preview did not render from the real read_asset");
    await shot("05-book-details");
    await dlg(`[...d.querySelectorAll("button")].find((b) => b.textContent.trim() === "Save details").click(); return "saved";`);
    await app.sleep(1500);
    assert(!(await app.snapshot()).dialogs.some((d) => d.includes("Book details")), "dialog did not close");
    const manifest = JSON.parse(readFileSync(join(book, "cadabra.json"), "utf8"));
    assert(manifest.cover === "assets/pixel.png" && manifest.isbn === "978-3-16-148410-0", `manifest wrong: cover=${manifest.cover} isbn=${manifest.isbn}`);
    assert(manifest.title === "Scenario Book" && manifest.chapters.length === 1, "other fields changed");
    return "cover assets/pixel.png, ISBN saved";
  });

  await step("EPUB export with a cover: cover page first, cover-image item, EPUBCheck clean", async () => {
    await exportVia("EPUB 3");
    await app.sleep(1500);
    for (let i = 0; i < 15 && !(await status()).includes("exports/book.epub"); i++) await app.sleep(1000);
    const epub = join(book, "exports/book.epub");
    const opf = execFileSync("unzip", ["-p", epub, "OEBPS/content.opf"], { encoding: "utf8" });
    assert(opf.includes('properties="cover-image"') && /<spine><itemref idref="epub-cover"\/>/.test(opf), "cover missing from the package");
    assert(execFileSync("unzip", ["-l", epub], { encoding: "utf8" }).includes("OEBPS/assets/pixel.png"), "cover image not in the EPUB");
    const jar = join(repo, "tools/epubcheck-5.4.0/epubcheck.jar");
    if (!existsSync(jar)) return "exported with cover (EPUBCheck jar not installed, validation skipped)";
    const o = execFileSync("java", ["-jar", jar, epub], { encoding: "utf8" });
    assert(o.includes("No errors or warnings detected"), o.slice(-300));
    return "EPUBCheck: 0 errors, 0 warnings";
  });

  await step("PDF export includes the cover as a blank-backed first page, and can leave it out", async () => {
    const pagesOf = (pdf: string) => execFileSync("pdftotext", ["-layout", pdf, "-"], { encoding: "utf8" }).split("\f").slice(0, -1);
    const pdf = join(book, "exports/book.pdf");
    const exportPdf = async (include: boolean) => {
      await app.click("Export"); await app.sleep(800);
      await dlg(`const o = [...d.querySelectorAll("button,[role=radio]")].find((e) => e.textContent.trim() === "Print PDF"); o.click(); return "picked";`);
      await app.sleep(400);
      assert(await dlg(`return !!d.querySelector('input[type="checkbox"]') && d.textContent.includes("Include the cover");`), "no Include the cover option");
      await dlg(`const c = [...d.querySelectorAll('input[type="checkbox"]')].find((i) => i.closest("label,div")?.textContent.includes("Include the cover")); if (c.checked !== ${include}) c.click(); return c.checked;`);
      await app.sleep(300);
      await dlg(`d.querySelector('button[type="submit"]').click(); return "submitted";`);
      await app.sleep(1500);
      for (let i = 0; i < 40 && (await app.snapshot()).dialogs.length; i++) await app.sleep(1000);
    };
    try {
      await exportPdf(true);
      const withCover = pagesOf(pdf);
      assert(withCover[0]?.trim() === "" && withCover[1]?.trim() === "", "first two pages (cover and its back) are not text-free");
      assert(withCover[2]?.includes("Scenario Book") && withCover[2]?.includes("Agent"), "title page is not on page 3");
      await exportPdf(false);
      const plain = pagesOf(pdf);
      assert(plain[0]?.includes("Scenario Book"), "without the cover the title page is not first");
      assert(withCover.length === plain.length + 2 && JSON.stringify(withCover.slice(2)) === JSON.stringify(plain), "later pages differ with a cover");
      return `with cover ${withCover.length} pages, without ${plain.length}; pages after the cover are identical`;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return "exported (poppler not installed, not inspected)";
      throw e;
    }
  });

  await step("menu commands act on the real app: Read, New Chapter and its Undo, Book Details, Settings, Close Project, Open Recent, New Project", async () => {
    const chapters = () => JSON.parse(readFileSync(join(book, "cadabra.json"), "utf8")).chapters.length;
    const editable = () => app.js(`document.querySelector(".ProseMirror")?.getAttribute("contenteditable")`);
    const before = chapters();
    await runMenu("view.read");
    assert((await editable()) === "false", "Read did not switch to reading mode");
    let m = await menuState();
    assert(m.items.get("view.read")?.checked === true && m.items.get("editor.bold")?.enabled === false, "in Read the formatting items should be greyed out and Read ticked");
    await runMenu("view.write");
    assert((await editable()) === "true", "Write did not switch back");
    await runMenu("insert.chapter");
    assert(chapters() === before + 1, "New Chapter did not add a chapter");
    m = await menuState();
    assert(/^Undo Add /.test(m.items.get("edit.bookUndo")?.text ?? "") && m.items.get("edit.bookUndo")?.enabled, `Undo should name the edit: ${m.items.get("edit.bookUndo")?.text}`);
    await runMenu("edit.bookUndo");
    assert(chapters() === before, "Undo did not remove the chapter");
    await runMenu("file.bookDetails");
    assert((await app.snapshot()).dialogs.some((d) => d.includes("Book details")), "Book Details did not open");
    await app.js(`document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))`); await app.sleep(600);
    await app.click("Cancel").catch(() => {}); await app.sleep(400);
    await runMenu("app.settings");
    assert((await app.snapshot()).headings.includes("Settings"), "Settings did not open");
    await app.click("Back").catch(() => {}); await app.sleep(800);
    await runMenu("file.close");
    assert((await app.snapshot()).buttons.includes("New project"), "Close Project did not return to the start screen");
    m = await menuState();
    assert(m.items.get("file.save")?.enabled === false && m.items.get("file.openRecent:" + book)?.enabled === true, "after closing, book actions should be greyed out and the book still in Open Recent");
    await runMenu("file.openRecent", book); await app.sleep(1500);
    assert((await app.snapshot()).headings.includes("Scenario Book"), "Open Recent did not reopen the book");
    await runMenu("file.new"); await app.sleep(1200);
    assert((await app.snapshot()).dialogs.some((d) => d.includes("New book")), "New Project from inside a book did not show the dialog");
    await app.click("Cancel"); await app.sleep(500);
    await runMenu("file.openRecent", book); await app.sleep(1500);
    assert((await app.snapshot()).headings.includes("Scenario Book"), "could not reopen the book");
    return "Read/Write, New Chapter and Undo, Book Details, Settings, Close Project, Open Recent and New Project all acted on the real window";
  });

  await step("find and replace: menu opens the bar, counts matches, replaces all; the book word count shows in the status bar", async () => {
    const editorText = () => app.js(`document.querySelector(".ProseMirror").textContent`);
    assert(/\d+ in the book/.test(await app.js(`document.body.innerText`)), "status bar lacks the whole-book word count");
    await runMenu("edit.find");
    assert(await app.js(`!!document.querySelector('[aria-label="Find and replace"]')`), "Find did not open the bar");
    await app.fill(0, "agent"); await app.sleep(500);
    assert(/1 of 1/.test(await app.js(`document.querySelector('[aria-label="Find and replace"]').innerText`)), "the bar does not show 1 of 1");
    await app.click("All chapters"); await app.sleep(900);
    const bookCount = await app.js(`document.querySelector('[aria-label="Find and replace"]').innerText`);
    assert(/of 2\b/.test(bookCount), `All chapters should also count the author on the title page: ${bookCount.slice(0, 60)}`);
    await app.click("All chapters"); await app.sleep(500);
    await runMenu("edit.findReplace");
    await app.fill(1, "robot"); await app.click("Replace all"); await app.sleep(500);
    const text = await editorText();
    assert(text.includes("Typed by an robot.") && !text.includes("agent."), `replace all did not change the text: ${text.slice(0, 80)}`);
    await app.js(`document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))`); await app.sleep(400);
    return "Find opened from the Edit menu, 1 of 1 shown, Replace all changed the real editor text";
  });

  await step("find and replace across chapters: Replace all rewrites other pages on disk, book Undo restores them", async () => {
    const pages = () => [join(book, "front-matter"), join(book, "back-matter"), join(book, "manuscript")].flatMap((d) => (existsSync(d) ? readdirSync(d).filter((f) => f.endsWith(".json")).map((f) => join(d, f)) : []));
    const count = (needle: string) => pages().filter((f) => readFileSync(f, "utf8").includes(needle)).length;
    const before = count("Agent");
    assert(before >= 1, "expected the author name on a front-matter page");
    await runMenu("edit.find");
    await app.fill(0, "Agent");
    await app.click("All chapters"); await app.sleep(900);
    await runMenu("edit.findReplace");
    await app.fill(1, "Writer"); await app.click("Replace all"); await app.sleep(1500);
    assert(count("Agent") === 0 && count("Writer") >= 1, `Replace all did not rewrite the pages on disk (Agent in ${count("Agent")}, Writer in ${count("Writer")})`);
    await app.js(`document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))`); await app.sleep(400);
    await runMenu("edit.bookUndo"); await app.sleep(1500);
    assert(count("Agent") === before && count("Writer") === 0, `book Undo did not restore the pages (Agent in ${count("Agent")}, Writer in ${count("Writer")})`);
    return `Replace all changed ${before} page(s) on disk; Undo put them back`;
  });

  await step("find and replace with Regex: capture groups in the replacement, an invalid pattern is refused", async () => {
    await runMenu("edit.find");
    await app.fill(0, "(ro)(bot)");
    await app.click("Regex"); await app.sleep(600);
    const bar = () => app.js(`document.querySelector('[aria-label="Find and replace"]').innerText`);
    assert(/1 of 1/.test(await bar()), `regex should match "robot": ${(await bar()).slice(0, 60)}`);
    await app.fill(0, "(unclosed"); await app.sleep(600);
    assert((await bar()).includes("Invalid pattern"), "an invalid pattern should say so");
    await app.fill(0, "(ro)(bot)"); await runMenu("edit.findReplace");
    await app.fill(1, "$2-$1"); await app.click("Replace all"); await app.sleep(600);
    const text = await app.js(`document.querySelector(".ProseMirror").textContent`);
    assert(text.includes("Typed by an bot-ro."), `capture groups were not applied: ${text.slice(0, 80)}`);
    await app.click("Regex");
    await app.js(`document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))`); await app.sleep(400);
    return "(ro)(bot) with $2-$1 gave bot-ro; (unclosed shows Invalid pattern";
  });

  await step("commands refuse a root that is not an existing project", async () => {
    const outcome = (cmd: string, args: unknown) => app.js(`window.__TAURI__.core.invoke(${JSON.stringify(cmd)}, ${JSON.stringify(args)}).then((r) => "resolved:" + JSON.stringify(r), (e) => "rejected:" + JSON.stringify(e))`);
    const notProject = join(out, "not-a-project");
    mkdirSync(notProject, { recursive: true });
    for (const [cmd, args] of [
      ["read_project_file", { root: "/", path: "etc/hosts" }],
      ["read_project_file", { root: "relative/book", path: "cadabra.json" }],
      ["write_project_file", { root: notProject, path: "manuscript/x.json", contents: "{}", baseHash: null }],
      ["write_project_bytes", { root: notProject, path: "exports/x.pdf", bytes: [1] }],
      ["read_asset", { root: notProject, path: "assets/x.png" }],
      ["list_project_trash", { root: notProject }],
    ] as [string, { root: string }][]) {
      const r = await outcome(cmd, args);
      assert(r.startsWith("rejected:") && r.includes("not_a_project"), `${cmd} on ${args.root}: ${r}`);
    }
    assert(!existsSync(join(notProject, "manuscript")) && !existsSync(join(notProject, "exports")), "a refused command still wrote into the folder");
    const opening = await outcome("read_project_file", { root: notProject, path: "cadabra.json" });
    assert(opening === "resolved:null", `opening a folder without a manifest should read as empty, got ${opening}`);
    const real = await outcome("read_project_file", { root: book, path: "cadabra.json" });
    assert(real.startsWith("resolved:") && real.includes("Scenario Book"), "the real project was refused");
    return "6 commands refused with not_a_project, nothing written; the real project still opens";
  });

  await step("Markdown export writes exports/book.md from the Export dialog", async () => {
    await exportVia("Markdown");
    for (let i = 0; i < 20 && !(await status()).includes("exports/book.md"); i++) await app.sleep(500);
    assert((await status()).includes("exports/book.md"), "Markdown export did not finish");
    const md = readFileSync(join(book, "exports/book.md"), "utf8");
    assert(md.includes("Typed by an bot-ro.") && md.includes("**Bold part.**"), `book.md lacks the chapter text: ${md.slice(0, 120)}`);
    await app.js(`document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))`); await app.sleep(500);
    return "exports/book.md has the chapter text with bold written as Markdown";
  });

  await step("import Markdown into a new project; source untouched; warnings reported", async () => {
    await app.js("location.reload()").catch(() => {}); await app.sleep(3000);
    await app.queueDialogs([join(src, "book.md"), imported]);
    await app.click("Import…"); await app.sleep(800);
    await app.click("Choose file…"); await app.sleep(500);
    await app.click("Choose…"); await app.sleep(500);
    await app.click("Next"); await app.sleep(1000);
    await app.click("Import"); await app.sleep(4000);
    const s = await app.snapshot();
    assert(s.dialogs.some((d) => d.includes("Imported 2 chapters") && d.includes("Raw HTML")), "report missing or wrong");
    assert(readFileSync(join(src, "book.md"), "utf8") === mdBefore, "source file was modified");
    assert(existsSync(join(imported, "manuscript/002-second.json")), "chapter files missing");
    await shot("04-import-report");
  });

  await step("import a real .docx through the wizard: preview, rename, skip; source untouched", async () => {
    await app.click("Done").catch(() => {}); await app.sleep(500);
    await app.js("location.reload()").catch(() => {}); await app.sleep(3000);
    await app.queueDialogs([join(src, "book.docx"), importedDocx]);
    await app.click("Import…"); await app.sleep(800);
    await app.click("Choose file…"); await app.sleep(500);
    await app.click("Choose…"); await app.sleep(500);
    await app.click("Next"); await app.sleep(1500);
    const prev = await app.snapshot();
    assert(JSON.stringify(prev).includes("Title of chapter 2"), "preview step with chapter rows not shown");
    assert(!existsSync(join(importedDocx, "cadabra.json")), "something was written before Import");
    await shot("05-import-preview");
    await dlg(`const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set; const i = d.querySelector('input[aria-label="Title of chapter 1"]'); set.call(i, "Prologue"); i.dispatchEvent(new Event("input", { bubbles: true })); return "renamed";`);
    await dlg(`d.querySelector('input[aria-label="Include chapter 2"]').click(); return "skipped";`);
    await app.sleep(300);
    await app.click("Import"); await app.sleep(4000);
    const s = await app.snapshot();
    assert(s.dialogs.some((d) => d.includes("Imported 1 chapter")), "report missing or wrong chapter count");
    assert(readFileSync(join(src, "book.docx")).equals(docxBefore), "source .docx was modified");
    const files = readdirSync(join(importedDocx, "manuscript"));
    assert(files.length === 1, `expected 1 chapter file, got ${files.join(",")}`);
    assert(readFileSync(join(importedDocx, "manuscript", files[0] ?? ""), "utf8").includes("First chapter text"), "chapter text missing");
    assert(readFileSync(join(importedDocx, "cadabra.json"), "utf8").includes("Prologue"), "rename not in manifest");
    assert(!readFileSync(join(importedDocx, "cadabra.json"), "utf8").includes("Dusk"), "skipped chapter listed");
    await shot("06-import-docx-report");
  });

  await step("sponsor dialog: appears after an export, Sponsor is the only address the opener may open", async () => {
    await app.js(`localStorage.removeItem("cadabracraft.sponsor")`);
    await app.js("location.reload()").catch(() => {}); await app.sleep(3000);
    await app.queueDialogs([imported]);
    await app.click("Open folder"); await app.sleep(2500);
    await exportVia("EPUB 3");
    for (let i = 0; i < 20 && !(await app.snapshot()).dialogs.some((d) => d.includes("Enjoying CadabraCraft?")); i++) await app.sleep(500);
    const dialogs = (await app.snapshot()).dialogs;
    assert(dialogs.some((d) => d.includes("Enjoying CadabraCraft?") && d.includes("Exported exports/book.epub")), `no sponsor dialog: ${JSON.stringify(dialogs)}`);
    const { buttons } = await app.snapshot();
    for (const b of ["Don't show again", "Maybe later", "Sponsor"]) assert(buttons.includes(b), `missing ${b}`);
    await shot("06-sponsor");
    // The capability allows exactly the sponsor page: any other address must be refused before a browser opens.
    const refused = await app.js(`window.__TAURI__.core.invoke("plugin:opener|open_url", { url: "https://example.com/" }).then(() => "opened", (e) => "refused:" + String(e))`);
    assert(String(refused).startsWith("refused:"), `the opener opened a page outside its scope: ${refused}`);
    await app.click("Maybe later"); await app.sleep(600);
    assert(!(await app.snapshot()).dialogs.some((d) => d.includes("Enjoying CadabraCraft?")), "Maybe later did not close the dialog");
    return `dialog shown after the export; example.com refused (${String(refused).slice(0, 60)})`;
  });

  await step("closing the window right after typing saves the text first", async () => {
    await app.click("Done").catch(() => {}); await app.sleep(800); // the import report, when still open, would hold the focus
    await app.js(`(() => { const ed = document.querySelector('.ProseMirror'); ed.focus(); const s = getSelection(); s.selectAllChildren(ed); s.collapseToEnd(); document.execCommand('insertText', false, ' Typed just before closing.'); })()`);
    const dir = join(imported, "manuscript");
    const holds = () => readdirSync(dir).some((f) => readFileSync(join(dir, f), "utf8").includes("Typed just before closing."));
    assert(!holds(), "autosave already ran, so this would not test the close path");
    // Closing is asynchronous in the app (it waits for the save), so the call may not return before the window is gone.
    await app.js(`window.__TAURI__.window.getCurrentWindow().close()`).catch(() => {});
    for (let i = 0; i < 10 && !holds(); i++) await app.sleep(500);
    assert(holds(), "the text typed within the autosave delay was lost when the window closed");
    return "chapter file has the text typed less than a second before closing";
  });
} catch {
  process.exitCode = 1;
} finally {
  writeFileSync(join(out, "results.json"), JSON.stringify(results, null, 2));
  console.log(`\n${results.filter((r) => r.ok).length}/${results.length} steps passed. Artifacts: ${out}`);
  app.close();
  if (child) try { process.kill(-child.pid!); } catch {}
}
