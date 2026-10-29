import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { XMLParser } from "fast-xml-parser";
import { unzipSync } from "fflate";
import { z } from "zod";
import { buildEpub } from "@cadabracraft/export-epub";
import { bookToMarkdown } from "@cadabracraft/export-markdown";
import { renderPdf, type TrimSize } from "@cadabracraft/export-pdf";
import { createNodeRunner } from "@cadabracraft/export-pdf/node";
import { ProjectFsError, writeBytes } from "@cadabracraft/project-fs";
import { getTemplate, hasTemplate, resolveBookFonts, resolveTrimSize } from "@cadabracraft/templates";
import { exportDir } from "@cadabracraft/format";
import { loadBook } from "../book";
import { ToolError } from "../errors";
import { poppler, runEpubcheck, typstPath } from "../external";
import { editionOf, loadProject, projectRoot } from "../project";
import { type ToolDef, defineTool, withLock } from "../tooling";
import { PATH } from "./project";
import { errMsg } from "@cadabracraft/shared";

const LANGUAGE = z.string().min(1).optional().describe('Edition to export or inspect (a language code from cadabra_project_info); default is the source edition. Files go to exports/<language>/.');
const SKIP = z.boolean().optional().describe("Leave out pages that are not translated yet instead of failing with chapter_not_translated. Ignored for the source edition.");
/** Where an edition's export files are: `exports/<language>/…`. */
const out = (language: string, file: string): string => `${exportDir(language)}/${file}`;
const skippedNote = (skipped: { id: string }[]): string => (skipped.length ? `; ${skipped.length} untranslated page(s) left out` : "");
const skippedData = (skipped: { id: string }[]) => skipped.map((e) => e.id);

export const exportEpub = defineTool({
  name: "cadabra_export_epub",
  title: "Export EPUB",
  description: "Build exports/<language>/book.epub (EPUB 3) from one edition of the book, using the project's template CSS and its images. Runs EPUBCheck when the jar and java are available and returns its messages. Only writes under exports/.",
  input: { path: PATH, language: LANGUAGE, skipUntranslated: SKIP },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
  run: ({ path, language, skipUntranslated }, ctx) =>
    withLock(projectRoot(ctx, path), async () => {
      const { root, edition, dir, skipped, chapters, assets, templateId } = loadBook(ctx, path, { language, skipUntranslated });
      const EPUB = `${dir}/book.epub`;
      let bytes: Uint8Array;
      try {
        bytes = buildEpub({ title: edition.title, author: edition.author, language: edition.language, identifier: edition.identifier, isbn: edition.isbn, publishing: edition.publishing, modified: new Date() }, chapters, { assets, css: getTemplate(templateId).epub.css });
      } catch (e) {
        throw new ToolError("epub_error", errMsg(e));
      }
      writeBytes(root, EPUB, bytes);
      const epubcheck = await runEpubcheck(ctx, join(root, EPUB));
      const check = !epubcheck.ran ? `EPUBCheck not run (${epubcheck.reason})` : epubcheck.passed ? "EPUBCheck passed" : `EPUBCheck reported ${epubcheck.messages.length} message(s)`;
      return { summary: `Wrote ${EPUB} (${bytes.length} bytes, ${chapters.length} chapters). ${check}${skippedNote(skipped)}`, data: { file: EPUB, language: edition.language, bytes: bytes.length, chapterCount: chapters.length, skipped: skippedData(skipped), template: templateId, epubcheck } };
    }),
});

export const exportMarkdown = defineTool({
  name: "cadabra_export_markdown",
  title: "Export Markdown",
  description:
    "Write exports/<language>/book.md (CommonMark + GFM: footnotes, tables, strikethrough) with every page in reading order; chapters without a level-1 heading get '# Title'. Image paths are written relative to exports/ (../assets/x.png). Underline, small caps, superscript and subscript have no Markdown syntax: the export fails (markdown_error) unless htmlMarks is true, which writes them as inline HTML. Only writes under exports/.",
  input: { path: PATH, htmlMarks: z.boolean().optional().describe("Write underline, small caps, superscript and subscript as inline HTML instead of failing."), language: LANGUAGE, skipUntranslated: SKIP },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
  run: ({ path, htmlMarks, language, skipUntranslated }, ctx) =>
    withLock(projectRoot(ctx, path), async () => {
      const { root, edition, dir, skipped, chapters } = loadBook(ctx, path, { language, skipUntranslated });
      const MARKDOWN = `${dir}/book.md`;
      let markdown: string;
      try {
        markdown = bookToMarkdown({ title: edition.title, author: edition.author }, chapters, { htmlMarks: htmlMarks === true, imageBase: "../" });
      } catch (e) {
        throw new ToolError("markdown_error", errMsg(e));
      }
      const bytes = new TextEncoder().encode(markdown);
      writeBytes(root, MARKDOWN, bytes);
      return { summary: `Wrote ${MARKDOWN} (${bytes.length} bytes, ${chapters.length} chapters)${skippedNote(skipped)}`, data: { file: MARKDOWN, language: edition.language, bytes: bytes.length, chapterCount: chapters.length, skipped: skippedData(skipped), htmlMarks: htmlMarks === true } };
    }),
});

export const exportPdf = defineTool({
  name: "cadabra_export_pdf",
  title: "Export PDF",
  description: "Build exports/<language>/book.pdf (print PDF via Typst) from one edition of the book. trimSize/template/pdfA/bleedIn/cropMarks override the book's settings for this export only; the manifest is not changed. Fonts default to the book's own (`fonts` in cadabra.json), else the template's; bodyFont/headingFont override per key, and a font that is not installed fails with font_missing instead of being substituted. Needs typst installed. Only writes under exports/.",
  input: {
    path: PATH,
    trimSize: z.enum(["4.25x6.87", "5x8", "5.25x8", "5.5x8.5", "6x9", "7x10", "8.5x11"]).optional().describe("Page size in inches for this export; default is the book's own trim size (cadabra.json `trimSize`), else the template's."),
    template: z.string().optional().describe("Template id for this export; default is the book's template."),
    bodyFont: z.string().trim().min(1).max(100).optional().describe("Body font family for this export; default is the book's own (`fonts.body`), else the template's."),
    headingFont: z.string().trim().min(1).max(100).optional().describe("Heading font family for this export; default is the book's own (`fonts.heading`), else the template's."),
    pdfA: z.boolean().optional().describe("Produce PDF/A-2b (archival)."),
    bleedIn: z.number().min(0).max(0.5).optional().describe("Bleed in inches (KDP: 0.125). The page grows by this much on the top, bottom and outside edges; margins stay measured from the trim. Default 0 (none)."),
    cropMarks: z.boolean().optional().describe("Draw crop marks outside the bleed (needs bleedIn > 0). The page then grows by the bleed plus 0.25 in on every side; KDP does not accept crop marks, other printers may ask for them."),
    language: LANGUAGE,
    skipUntranslated: SKIP,
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
  run: ({ path, trimSize, template, bodyFont, headingFont, pdfA, bleedIn, cropMarks, language, skipUntranslated }, ctx) =>
    withLock(projectRoot(ctx, path), async () => {
      if (template !== undefined && !hasTemplate(template)) getTemplate(template); // throws template_unknown listing the ids
      const { root, manifest, edition, dir, skipped, chapters, assets, templateId } = loadBook(ctx, path, { language, skipUntranslated });
      const PDF = `${dir}/book.pdf`;
      const id = template ?? templateId;
      const size: TrimSize = trimSize ?? resolveTrimSize({ template: id, ...(manifest.trimSize ? { trimSize: manifest.trimSize } : {}) });
      const bookFonts = { ...resolveBookFonts(manifest), ...(bodyFont ? { body: bodyFont } : {}), ...(headingFont ? { heading: headingFont } : {}) };
      const runner = createNodeRunner({ typstPath: typstPath(ctx) });
      const { pdf, fonts } = await renderPdf(
        { title: edition.title, author: edition.author, language: edition.language },
        chapters,
        { template: id, trimSize: size, assets: Object.fromEntries(assets), pdfA: pdfA === true, ...(bleedIn ? { bleedIn } : {}), ...(cropMarks ? { cropMarks: true } : {}), ...(Object.keys(bookFonts).length ? { fonts: bookFonts } : {}) },
        runner,
      );
      writeBytes(root, PDF, pdf);
      return { summary: `Wrote ${PDF} (${pdf.length} bytes, ${size}, template ${id}${pdfA ? ", PDF/A-2b" : ""}${bleedIn ? `, ${bleedIn} in bleed${cropMarks ? " with crop marks" : ""}` : ""})${skippedNote(skipped)}`, data: { file: PDF, language: edition.language, skipped: skippedData(skipped), bytes: pdf.length, options: { trimSize: size, template: id, pdfA: pdfA === true, bleedIn: bleedIn ?? 0, cropMarks: cropMarks === true }, fonts } };
    }),
});

function sizeOf(file: string, rel: string, hint: string): number {
  try {
    return statSync(file).size;
  } catch {
    throw new ToolError("not_found", `${rel} does not exist; ${hint}`);
  }
}

const POPPLER_NOTE = "poppler_missing: poppler (pdfinfo, pdffonts, pdftotext) was not found. Install it (e.g. `brew install poppler`) to inspect page count, size, fonts and text.";

export const inspectPdf = defineTool({
  name: "cadabra_inspect_pdf",
  title: "Inspect PDF",
  description: "Inspect exports/<language>/book.pdf with poppler: page count, page size, fonts (with embedding) and the text of the first page. If poppler is not installed the result says poppler_missing instead of failing.",
  input: { path: PATH, language: LANGUAGE },
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
  run: async ({ path, language }, ctx) => {
    const { root, manifest } = loadProject(ctx, path);
    const PDF = out(editionOf(manifest, language).language, "book.pdf");
    const file = join(root, PDF);
    const bytes = sizeOf(file, PDF, "run cadabra_export_pdf first");
    try {
      const info = await poppler(ctx, "pdfinfo", [file]);
      if (info === null) return { summary: `${PDF} exists (${bytes} bytes); ${POPPLER_NOTE}`, data: { file: PDF, bytes, poppler: "missing", note: POPPLER_NOTE } };
      const field = (name: string) => new RegExp(`^${name}:\\s+(.*)$`, "m").exec(info)?.[1]?.trim() ?? null;
      const fontsText = (await poppler(ctx, "pdffonts", [file])) ?? "";
      const fonts = fontsText
        .split("\n")
        .slice(2)
        .map((l) => l.trim().split(/\s+/))
        .filter((t) => t.length >= 8)
        .map((t) => ({ name: t[0]!, type: t.slice(1, -6).join(" "), embedded: t[t.length - 5] === "yes" }));
      const firstPageText = ((await poppler(ctx, "pdftotext", ["-f", "1", "-l", "1", "-layout", file, "-"])) ?? "").trim().slice(0, 4000);
      const pages = Number(field("Pages"));
      return {
        summary: `${PDF}: ${pages} pages, ${field("Page size")}, ${fonts.length} font(s)`,
        data: { file: PDF, bytes, poppler: "ok", pages, pageSize: field("Page size"), pdfVersion: field("PDF version"), fonts, firstPageText },
      };
    } catch (e) {
      if (e instanceof ToolError || e instanceof ProjectFsError) throw e;
      throw new ToolError("pdf_error", `poppler could not read ${PDF}: ${errMsg(e).split("\n")[0]}`);
    }
  },
});

const xml = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@", removeNSPrefix: true, processEntities: true });
const first = (v: unknown): string | null => {
  const x = Array.isArray(v) ? v[0] : v;
  if (x === undefined || x === null) return null;
  if (typeof x === "object") return first((x as Record<string, unknown>)["#text"]);
  return String(x);
};
const list = <T>(v: T | T[] | undefined): T[] => (v === undefined ? [] : Array.isArray(v) ? v : [v]);

export const inspectEpub = defineTool({
  name: "cadabra_inspect_epub",
  title: "Inspect EPUB",
  description: "Inspect exports/<language>/book.epub: zip entries, OPF title/author/language/identifier and the number of chapters in the spine.",
  input: { path: PATH, language: LANGUAGE },
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
  run: ({ path, language }, ctx) => {
    const { root, manifest } = loadProject(ctx, path);
    const EPUB = out(editionOf(manifest, language).language, "book.epub");
    const bytes = sizeOf(join(root, EPUB), EPUB, "run cadabra_export_epub first");
    const entries: string[] = [];
    let zip: Record<string, Uint8Array>;
    try {
      zip = unzipSync(new Uint8Array(readFileSync(join(root, EPUB))), {
        filter: (f) => {
          entries.push(f.name);
          return f.name === "META-INF/container.xml" || f.name.endsWith(".opf");
        },
      });
    } catch (e) {
      throw new ToolError("epub_error", `${EPUB} is not a valid zip file: ${errMsg(e)}`);
    }
    const dec = new TextDecoder();
    const container = zip["META-INF/container.xml"];
    const opfPath = container ? first(xml.parse(dec.decode(container))?.container?.rootfiles?.rootfile?.["@full-path"]) : null;
    const opfBytes = opfPath ? zip[opfPath] : undefined;
    if (!opfPath || !opfBytes) throw new ToolError("epub_error", `${EPUB} has no readable package document (OPF)`);
    const pkg = xml.parse(dec.decode(opfBytes)).package ?? {};
    const meta = pkg.metadata ?? {};
    const items = new Map(list<Record<string, string>>(pkg.manifest?.item).map((i) => [i["@id"], i]));
    const chapterCount = list<Record<string, string>>(pkg.spine?.itemref).filter((r) => {
      const item = items.get(r["@idref"] ?? "");
      return !item || (item["@media-type"] === "application/xhtml+xml" && !/\bnav\b/.test(item["@properties"] ?? ""));
    }).length;
    const data = {
      file: EPUB,
      bytes,
      entries,
      opf: opfPath,
      epubVersion: first(pkg["@version"]),
      title: first(meta.title),
      author: first(meta.creator),
      language: first(meta.language),
      identifier: first(meta.identifier),
      chapterCount,
    };
    return { summary: `${EPUB}: "${data.title}" by ${data.author}, ${chapterCount} chapter(s), ${entries.length} entries`, data };
  },
});

export const exportTools: ToolDef[] = [exportEpub, exportPdf, exportMarkdown, inspectPdf, inspectEpub];
