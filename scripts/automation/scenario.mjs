#!/usr/bin/env node
// End-to-end click-through of the REAL desktop app (create, edit, image, EPUB, PDF, import) with assertions.
// Usage: node scripts/automation/scenario.mjs [--launch] [--out <dir>]
//   --launch  start `pnpm tauri:automate` first (waits for the bridge) and stop it afterwards
//   --out     where to put the scratch books and screenshots (default: a new temp dir)
import { spawn, execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { connect } from "./client.mjs";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const args = process.argv.slice(2);
const out = args.includes("--out") ? resolve(args[args.indexOf("--out") + 1]) : mkdtempSync(join(tmpdir(), "cadabra-scenario-"));
mkdirSync(out, { recursive: true });

const results = [];
const step = async (name, fn) => {
  try {
    const detail = await fn();
    results.push({ name, ok: true, detail });
    console.log(`PASS ${name}${detail ? ` - ${detail}` : ""}`);
  } catch (e) {
    results.push({ name, ok: false, detail: e.message });
    console.log(`FAIL ${name} - ${e.message}`);
    throw e;
  }
};
const assert = (cond, msg) => { if (!cond) throw new Error(msg); };

let app;
let child;
if (args.includes("--launch")) {
  child = spawn("pnpm", ["--filter", "@cadabracraft/desktop", "tauri:automate"], { cwd: repo, stdio: "ignore", detached: true });
  for (let i = 0; i < 90; i++) {
    try { app = await connect({ timeoutMs: 30000 }); break; } catch { await new Promise((r) => setTimeout(r, 2000)); }
  }
}
app ??= await connect();

const book = join(out, "book"), imported = join(out, "imported"), src = join(out, "src");
for (const d of [book, imported, src]) mkdirSync(d, { recursive: true });
writeFileSync(join(src, "book.md"), "# First\n\nHello *world*[^1].\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n# Second\n\nMore.\n\n[^1]: Note.\n");
const mdBefore = readFileSync(join(src, "book.md"), "utf8");
const png = join(repo, "fixtures/assets/pixel.png");
const shot = (n) => app.screenshot(join(out, `${n}.png`));
// Radix menus open on pointerdown, so a plain click() is not enough for the trigger; items react to click().
const openMenu = (label) => app.js(`(() => { const b = [...document.querySelectorAll("button")].find((b) => (b.textContent.trim() || b.getAttribute("aria-label")) === ${JSON.stringify(label)});
  if (!b) throw new Error("no button: ${label}"); b.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0, pointerType: "mouse" })); return "opened"; })()`);
const pickItem = (label) => app.js(`(() => { const i = [...document.querySelectorAll('[role="menuitem"]')].find((i) => i.textContent.trim() === ${JSON.stringify(label)});
  if (!i) throw new Error("no menu item: ${label}"); i.click(); return "picked"; })()`);
const status = async () => (await app.snapshot()).status.join(" ");

try {
  await step("start screen shows New project, Open folder, Import", async () => {
    await app.js("location.reload()").catch(() => {});
    await app.sleep(3000);
    const { buttons } = await app.snapshot();
    for (const b of ["New project", "Open folder", "Import…"]) assert(buttons.includes(b), `missing ${b}`);
    await shot("01-start");
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

  await step("add a title page and a back-matter page through the Add page menu", async () => {
    await openMenu("Add page"); await app.sleep(400);
    await pickItem("Title page"); await app.sleep(1500);
    const editorH1 = () => app.js(`document.querySelector(".ProseMirror h1")?.textContent ?? ""`);
    assert((await editorH1()) === "Scenario Book" && (await app.js(`document.querySelector(".ProseMirror").textContent`)).includes("Agent"), "title page did not open in the editor");
    await openMenu("Add page"); await app.sleep(400);
    await pickItem("About the author"); await app.sleep(1500);
    assert((await editorH1()) === "About the Author", "about-the-author page did not open");
    const manifest = JSON.parse(readFileSync(join(book, "cadabra.json"), "utf8"));
    assert(manifest.formatVersion === 2, "manifest is not format 2");
    assert(manifest.frontMatter[0]?.kind === "title-page" && manifest.backMatter[0]?.kind === "about-the-author", "kinds missing in the manifest");
    assert(existsSync(join(book, "front-matter/01-title-page.json")) && existsSync(join(book, "back-matter/01-about-the-author.json")), "matter files not written by Rust");
    assert(readFileSync(join(book, "front-matter/01-title-page.json"), "utf8").includes("Agent"), "title page lacks the author");
    await shot("03b-matter");
    return "front-matter/01-title-page.json, back-matter/01-about-the-author.json";
  });

  await step("EPUB export passes EPUBCheck and contains the matter pages", async () => {
    await app.click("Export EPUB"); await app.sleep(3000);
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
    await app.click("Export PDF…"); await app.sleep(800);
    await app.click("Export PDF"); await app.sleep(1000);
    for (let i = 0; i < 40 && !(await status()).includes("exports/book.pdf"); i++) await app.sleep(1000);
    assert((await status()).includes("exports/book.pdf"), "PDF export did not finish (is Typst installed?)");
    const pdf = join(book, "exports/book.pdf");
    try {
      const info = execFileSync("pdfinfo", [pdf], { encoding: "utf8" });
      assert(/Page size:\s+432 x 648/.test(info), "wrong page size");
      const pages = execFileSync("pdftotext", ["-layout", pdf, "-"], { encoding: "utf8" }).split("\f");
      assert(pages[0].includes("Scenario Book") && pages[0].includes("Agent"), "title page is not first");
      assert(pages.some((p) => p.includes("About the Author")), "back matter missing from the PDF");
      assert(pages.findIndex((p) => p.includes("Typed by an agent")) < pages.findIndex((p) => p.includes("About the Author")), "back matter is not after the chapters");
      return "432x648 pt (6x9 in), title page first, about-the-author last";
    } catch (e) {
      if (e.code === "ENOENT") return "exported (poppler not installed, not inspected)";
      throw e;
    }
  });

  await step("import Markdown into a new project; source untouched; warnings reported", async () => {
    await app.js("location.reload()").catch(() => {}); await app.sleep(3000);
    await app.queueDialogs([join(src, "book.md"), imported]);
    await app.click("Import…"); await app.sleep(800);
    await app.click("Choose file…"); await app.sleep(500);
    await app.click("Choose…"); await app.sleep(500);
    await app.click("Import"); await app.sleep(4000);
    const s = await app.snapshot();
    assert(s.dialogs.some((d) => d.includes("Imported 2 chapters") && d.includes("table")), "report missing or wrong");
    assert(readFileSync(join(src, "book.md"), "utf8") === mdBefore, "source file was modified");
    assert(existsSync(join(imported, "manuscript/002-second.json")), "chapter files missing");
    await shot("04-import-report");
  });
} catch {
  process.exitCode = 1;
} finally {
  writeFileSync(join(out, "results.json"), JSON.stringify(results, null, 2));
  console.log(`\n${results.filter((r) => r.ok).length}/${results.length} steps passed. Artifacts: ${out}`);
  app.close();
  if (child) try { process.kill(-child.pid); } catch {}
}
