// M0 spike: render the sample chapter to 6x9 print PDF with Paged.js (Chromium) and Typst, for comparison.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { chromium } from "playwright";
import { chapterToXhtmlBody } from "@cadabracraft/export-epub";
import type { ChapterDoc, DocNode } from "@cadabracraft/shared";

const doc: ChapterDoc = JSON.parse(readFileSync("../../fixtures/manuscripts/sample-chapter.json", "utf8"));
const out = "../../out";
mkdirSync(out, { recursive: true });

// Paged.js: styled HTML + @page rules, printed by headless Chromium.
const css = `
@page { size: 6in 9in; margin: 0.75in 0.7in 0.9in 0.9in; @bottom-center { content: counter(page); } @top-center { content: "Spike Book"; font-size: 9pt; } }
@page :left { margin: 0.75in 0.9in 0.9in 0.7in; }
body { font-family: "Times New Roman", serif; font-size: 11pt; line-height: 1.4; }
p { margin: 0; text-indent: 1.2em; } h1 { page-break-before: always; } hr.scene-break { border: 0; text-align: center } hr.scene-break:after { content: "* * *" }
.small-caps { font-variant: small-caps } a.noteref { vertical-align: super; font-size: .75em } aside ol { font-size: 9pt }`;
const html = `<!doctype html><html xmlns:epub="x"><head><meta charset="utf-8"><style>${css}</style></head><body>${chapterToXhtmlBody(doc)}</body></html>`;
const browser = await chromium.launch();
const page = await browser.newPage();
await page.setContent(html);
await page.addScriptTag({ path: "node_modules/pagedjs/dist/paged.polyfill.js" });
await page.waitForSelector(".pagedjs_pages", { state: "attached", timeout: 30000 });
await page.waitForFunction(() => document.querySelectorAll(".pagedjs_page").length > 0);
await page.pdf({ path: `${out}/pagedjs.pdf`, preferCSSPageSize: true, printBackground: true });
await browser.close();

// Typst: JSON -> Typst markup directly.
const t = (s: string) => s.replace(/[\\#$*_`<>@~]/g, (c) => "\\" + c);
function inline(nodes: DocNode[] = []): string {
  return nodes.map((n) => {
    if (n.type === "text") {
      let s = t(n.text);
      for (const m of n.marks ?? []) s = m.type === "bold" ? `*${s}*` : m.type === "italic" ? `_${s}_` : m.type === "smallCaps" ? `#smallcaps[${s}]` : m.type === "underline" ? `#underline[${s}]` : `#link("${m.attrs?.href}")[${s}]`;
      return s;
    }
    if (n.type === "footnote") return `#footnote[${inline(n.content)}]`;
    return blk(n);
  }).join("");
}
function blk(n: DocNode): string {
  const k = "content" in n ? n.content : undefined;
  switch (n.type) {
    case "paragraph": return inline(k) + "\n\n";
    case "heading": return `${"=".repeat(Number(n.attrs?.level ?? 1))} ${inline(k)}\n\n`;
    case "blockquote": return `#quote(block: true)[${(k ?? []).map(blk).join("")}]\n\n`;
    case "sceneBreak": return `#align(center)[\\* \\* \\*]\n\n`;
    case "bulletList": return (k ?? []).map((li) => "- " + blk(li).trim() + "\n").join("") + "\n";
    case "orderedList": return (k ?? []).map((li) => "+ " + blk(li).trim() + "\n").join("") + "\n";
    case "listItem": return (k ?? []).map(blk).join("");
    default: return "";
  }
}
const typ = `#set page(width: 6in, height: 9in, margin: (inside: 0.9in, outside: 0.7in, top: 0.75in, bottom: 0.9in),
  header: context { if calc.even(here().page()) [Spike Book] else [Chapter One] },
  footer: context align(center, counter(page).display()))
#set text(font: "Libertinus Serif", size: 11pt)
#set par(justify: true, first-line-indent: 1.2em)
${(doc.content as DocNode[]).map(blk).join("")}`;
writeFileSync(`${out}/spike.typ`, typ);
execFileSync("typst", ["compile", "--pdf-standard", "a-2b", `${out}/spike.typ`, `${out}/typst.pdf`], { stdio: "inherit" });
console.log("wrote out/pagedjs.pdf and out/typst.pdf");
