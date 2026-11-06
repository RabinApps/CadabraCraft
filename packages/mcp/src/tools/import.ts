// import_file: the same order of work as apps/desktop/src/app/importBook.ts (parse everything, load images, then write
// images, chapters and the manifest LAST), without the webview. The source is only ever read.
import { existsSync, readdirSync, statSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { addChapter, createManifest, serializeManifest, sourceFile } from "@cadabracraft/format";
import { outlineFormatOfFile, outlineToPages, parseOutline, type OutlineImportFormat } from "@cadabracraft/outline";
import { ImportError, importDocx, importHtml, importMarkdown, type ImportResult, type ImportWarning } from "@cadabracraft/import-docx";
import { MANIFEST, ProjectFsError, createProject, fileBaseName, readProjectFile, readRelativeImage, readSource, resolveInWorkspace, storeImage, writeProjectFile } from "@cadabracraft/project-fs";
import { remapImages } from "../doc";
import { ToolError } from "../errors";
import { loadProject, projectRoot, saveManifest } from "../project";
import { PATH } from "./project";
import { type ToolDef, defineTool, withLock } from "../tooling";
import { errMsg } from "@cadabracraft/shared";

export interface WarningGroup {
  code: string;
  severity: ImportWarning["severity"];
  /** Total occurrences (a warning may stand for several). */
  count: number;
  /** First message, as a description of the group. */
  message: string;
  /** Up to three short examples. */
  examples: string[];
}

/** Groups warnings by code: counts occurrences and keeps a few examples. Warnings (content lost) come before info. */
export function groupWarnings(warnings: ImportWarning[]): WarningGroup[] {
  const groups = new Map<string, WarningGroup>();
  for (const w of warnings) {
    let g = groups.get(w.code);
    if (!g) groups.set(w.code, (g = { code: w.code, severity: w.severity, count: 0, message: w.message, examples: [] }));
    if (w.severity === "warning") g.severity = "warning";
    g.count += w.count ?? 1;
    const ex = [...(w.examples ?? []), ...(w.examples?.length ? [] : [w.line ? `${w.message} (line ${w.line})` : w.message])];
    for (const e of ex) if (g.examples.length < 3 && !g.examples.includes(e)) g.examples.push(e);
  }
  return [...groups.values()].sort((a, b) => Number(b.severity === "warning") - Number(a.severity === "warning") || b.count - a.count);
}

/**
 * Source bytes as text: a UTF-8 BOM is dropped, a UTF-16 BOM selects UTF-16, and anything else must be valid UTF-8.
 * Guessing (Latin-1, UTF-16 without BOM) would import garbage silently, so those are refused with a message instead.
 */
export function decodeSourceText(bytes: Uint8Array, name: string): string {
  const b0 = bytes[0];
  const b1 = bytes[1];
  try {
    if (b0 === 0xff && b1 === 0xfe) return new TextDecoder("utf-16le", { fatal: true }).decode(bytes.subarray(2));
    if (b0 === 0xfe && b1 === 0xff) return new TextDecoder("utf-16be", { fatal: true }).decode(bytes.subarray(2));
    if (bytes.subarray(0, 4096).includes(0)) throw new Error("it contains NUL bytes (probably UTF-16 without a byte order mark)");
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes).replace(/^\ufeff/, "");
  } catch (e) {
    const why = e instanceof Error && e.message.startsWith("it contains") ? e.message : "it is not valid UTF-8 or UTF-16 text";
    throw new ToolError("invalid_file", `${name} cannot be read as text: ${why}. Save the file as UTF-8 and try again.`);
  }
}

const decode = (s: string): string => {
  try {
    return decodeURIComponent(s);
  } catch {
    // Malformed percent-escape: keep the text as written.
    return s;
  }
};

/** Markdown references may be percent-encoded and carry `?query`/`#fragment`; try them as written first. */
const imageCandidates = (ref: string): string[] => [...new Set([ref, decode(ref.replace(/[?#].*$/, ""))])];

const titleFromFile = (path: string): string => fileBaseName(path).replace(/\.[^.]*$/, "").replace(/[_-]+/g, " ").trim() || "Untitled";

function checkDestination(dest: string): void {
  if (!existsSync(dest)) return;
  const notEmpty = () => new ToolError("destination_not_empty", `destination must not exist or be an empty folder: ${dest}`);
  if (!statSync(dest).isDirectory()) throw notEmpty();
  if (readdirSync(dest).length > 0) throw notEmpty();
}

function readSourceChecked(sourcePath: string, outline = false): Uint8Array {
  try {
    return readSource(sourcePath, outline);
  } catch (e) {
    if (e instanceof ProjectFsError && e.code !== "not_found") throw new ToolError("source_invalid", e.message);
    throw e;
  }
}

function parseManuscript(sourcePath: string, bytes: Uint8Array): ImportResult {
  const isDocx = /\.docx$/i.test(sourcePath);
  const isHtml = /\.html?$/i.test(sourcePath);
  const text = isDocx ? "" : decodeSourceText(bytes, fileBaseName(sourcePath));
  try {
    return isDocx ? importDocx(bytes) : isHtml ? importHtml(text) : importMarkdown(text);
  } catch (e) {
    if (e instanceof ImportError) throw new ToolError("import_failed", `${e.message} (${e.code})`, { importCode: e.code });
    throw e;
  }
}

/** The bytes of one image, read from the manuscript's folder; throws the last read error when no candidate path works. */
function readImageData(sourcePath: string, ref: string): Uint8Array {
  let last: unknown;
  for (const candidate of imageCandidates(ref)) {
    try {
      return readRelativeImage(sourcePath, candidate);
    } catch (e) {
      last = e;
    }
  }
  throw last;
}

function loadImages(assets: ImportResult["assets"], sourcePath: string, warnings: ImportWarning[]): { target: string; name: string; bytes: Uint8Array }[] {
  const images: { target: string; name: string; bytes: Uint8Array }[] = [];
  for (const a of assets) {
    try {
      const data = a.bytes ?? readImageData(sourcePath, a.sourcePath);
      images.push({ target: a.targetPath, name: fileBaseName(a.targetPath), bytes: data });
    } catch (e) {
      warnings.push({ code: "image-not-imported", severity: "warning", message: `Image ${a.sourcePath} could not be imported: ${errMsg(e)}`, examples: [a.sourcePath] });
    }
  }
  return images;
}

export const importFile = defineTool({
  name: "cadabra_import_file",
  title: "Import manuscript",
  description: "Import a Markdown (.md/.markdown/.txt), HTML (.html/.htm) or Word (.docx) manuscript into a NEW project folder. Chapters split on top-level headings; images are copied into assets/. The source is never modified; the destination must not exist or be an empty folder. Returns a grouped warning report of anything that could not be kept (see cadabra://docs/import).",
  input: {
    source: z.string().min(1).describe("Manuscript file, relative to the workspace root or an absolute path inside it."),
    destination: z.string().min(1).describe("New project folder (nonexistent or empty)."),
    title: z.string().min(1).optional().describe("Book title; defaults to the file name."),
    author: z.string().min(1).optional().describe('Author; defaults to "Anonymous".'),
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
  run: ({ source, destination, title, author }, ctx) => {
    const sourcePath = resolveInWorkspace(ctx.ws, source);
    const dest = resolveInWorkspace(ctx.ws, destination);
    checkDestination(dest);

    // 1. Read and parse. Nothing is created when this fails.
    const bytes = readSourceChecked(sourcePath);
    const result = parseManuscript(sourcePath, bytes);
    if (result.chapters.length === 0) throw new ToolError("empty_input", "there is no text to import in this file", { warnings: groupWarnings(result.warnings) });

    // 2. Load images into memory (still no writes). An unreadable or refused image is a warning, not a failure.
    const warnings: ImportWarning[] = [...result.warnings];
    const images = loadImages(result.assets, sourcePath, warnings);

    // 3. Write. The manifest goes last with the chapter list, so an interrupted import never lists missing files.
    const written = { images: 0, chapters: 0 };
    let manifest = createManifest({ title: title ?? titleFromFile(sourcePath), author: author ?? "Anonymous", language: "en", identifier: `urn:uuid:${randomUUID()}` });
    try {
      createProject(dest, serializeManifest(manifest));
      const map = new Map<string, string | null>();
      for (const a of result.assets) map.set(a.targetPath, null);
      for (const img of images) {
        try {
          map.set(img.target, storeImage(dest, img.name, img.bytes));
          written.images++;
        } catch (e) {
          warnings.push({ code: "image-not-imported", severity: "warning", message: `Image ${img.name} could not be stored: ${errMsg(e)}`, examples: [img.name] });
        }
      }
      for (const c of result.chapters) {
        const next = addChapter(manifest, c.title);
        manifest = next.manifest;
        writeProjectFile(dest, sourceFile(next.entry, next.manifest.editions), JSON.stringify(remapImages(c.doc, map), null, 2));
        written.chapters++;
      }
      writeProjectFile(dest, MANIFEST, serializeManifest(manifest));
    } catch (e) {
      const msg = errMsg(e);
      throw new ToolError("import_write_failed", `${msg} Already written to ${dest}: ${written.chapters} chapter files and ${written.images} images; the book's chapter list was not saved.`, { written, destination: dest });
    }
    const groups = groupWarnings(warnings);
    return {
      summary: `Imported ${result.chapters.length} chapter(s) and ${written.images} image(s) into ${dest}; ${groups.length} warning group(s)`,
      data: { root: dest, manifest, chapterCount: result.chapters.length, imageCount: written.images, warnings: groups },
    };
  },
});

const OUTLINE_FORMAT = z.enum(["opml", "markdown", "csv"]);

export const importOutline = defineTool({
  name: "cadabra_import_outline",
  title: "Import outline",
  description:
    "Add the chapters and scenes of an outline file (.opml, .csv, or a Markdown outline with `#` chapters and `##` scenes) after the last chapter of an existing book. Each scene gets its title, synopsis and, where the file has them, POV, status, label, target words and story date; scenes get new ids and an empty paragraph to write in. Nothing existing is changed or overwritten (chapter files are new; the manifest is saved last) and the source file is only read. A cast the file names is not imported (see the warnings). A malformed, hostile or empty file fails with a typed error and writes nothing.",
  input: {
    path: PATH,
    source: z.string().min(1).describe("Outline file, relative to the workspace root or an absolute path inside it."),
    format: OUTLINE_FORMAT.optional().describe("opml, markdown or csv; by default from the file extension (.opml, .csv, .md or .markdown). Use it to read a .md as something else, or a .csv saved as .md."),
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
  run: ({ path, source, format }, ctx) =>
    withLock(projectRoot(ctx, path), () => {
      const sourcePath = resolveInWorkspace(ctx.ws, source);
      // 1. Read and parse; nothing is written when this fails.
      const bytes = readSourceChecked(sourcePath, true);
      // The extension passed the outline list, so it names a format (`format` overrides it).
      const kind: OutlineImportFormat = format ?? outlineFormatOfFile(sourcePath)!;
      const text = decodeSourceText(bytes, fileBaseName(sourcePath));
      const parsed = parseOutline(text, kind);
      const { pages, warnings } = outlineToPages(parsed, () => `sc-${randomUUID().slice(0, 8)}`);
      // 2. Write: new chapter files first, the manifest last, so an interrupted import never lists a missing file.
      const { root, manifest, hash } = loadProject(ctx, path);
      let next = manifest;
      const added: { id: string; title: string; file: string; sceneCount: number }[] = [];
      const files: { file: string; contents: string }[] = [];
      for (const p of pages) {
        const r = addChapter(next, p.title);
        next = r.manifest;
        const file = sourceFile(r.entry, next.editions);
        if (readProjectFile(root, file) || files.some((f) => f.file === file)) throw new ToolError("io_error", `${file} already exists on disk but is not listed in the book; refusing to overwrite it`);
        files.push({ file, contents: JSON.stringify(p.doc, null, 2) });
        added.push({ id: r.entry.id, title: p.title, file, sceneCount: p.sceneCount });
      }
      // A failed write leaves new chapter files the book does not list yet (never an overwritten one); the manifest is last.
      for (const f of files) writeProjectFile(root, f.file, f.contents);
      const w = saveManifest(root, next, hash);
      const scenes = added.reduce((n, c) => n + c.sceneCount, 0);
      return {
        summary: `Added ${added.length} chapter(s) with ${scenes} scene(s) from ${fileBaseName(sourcePath)}; ${warnings.length} warning(s)`,
        data: { chapters: added, sceneCount: scenes, warnings, manifestHash: w.hash, conflictCopy: w.conflictCopy },
      };
    }),
});

export const importTools: ToolDef[] = [importFile, importOutline];
