import { t } from "@lingui/core/macro";
import { i18n } from "@lingui/core";
import { addChapter, createManifest, serializeManifest } from "@cadabracraft/format";
import { ImportError, importDocx, importHtml, importMarkdown, type ImportResult, type ImportWarning } from "@cadabracraft/import-docx";
import type { ChapterDoc } from "@cadabracraft/shared";
import { bridge } from "./bridge";
import { baseName, stem } from "./paths";
import { errText } from "./projectError";

export interface ImportReport {
  /** Source file name (no folder), for display. */
  fileName: string;
  title: string;
  chapterCount: number;
  /** Images stored in the project's assets/. */
  imageCount: number;
  /** Importer warnings plus `image-not-imported` for images that could not be read or stored. */
  warnings: ImportWarning[];
}

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


/** Groups warnings by code: counts occurrences and keeps a few examples (located warnings show their line). */
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
  // Warnings (content lost) before info (benign), then most frequent first.
  return [...groups.values()].sort((a, b) => Number(b.severity === "warning") - Number(a.severity === "warning") || b.count - a.count);
}

/** Plain-text report, for pasting into a bug report. */
export function formatReport(r: ImportReport): string {
  const lines = [`Import of ${r.fileName}: ${r.chapterCount} chapter(s), ${r.imageCount} image(s)`];
  for (const g of groupWarnings(r.warnings)) {
    lines.push(`- [${g.severity}] ${g.code} x${g.count}: ${g.message}`);
    for (const e of g.examples) lines.push(`    ${e}`);
  }
  if (!r.warnings.length) lines.push("No warnings.");
  return lines.join("\n");
}

function describeImportError(e: ImportError): string {
  switch (e.code) {
    case "invalid-zip": return t`This does not look like a valid .docx file (it could not be opened as a Word document).`;
    case "archive-too-large": return t`This document is too large to import safely.`;
    case "too-many-entries": return t`This document contains too many parts to import safely.`;
    case "missing-document": return t`This .docx file has no document body. It may be damaged or not a Word document.`;
    case "invalid-xml": return t`This document's contents could not be read. It may be damaged.`;
    case "input-too-large": return t`This file is too large to import.`;
    case "too-deeply-nested": return t`This document is nested too deeply to import.`;
  }
}

/** Replaces image sources per `map` (null removes the image and leaves its alt text), without mutating the input. */
export function remapImages(doc: ChapterDoc, map: Map<string, string | null>): ChapterDoc {
  const walk = (n: unknown): unknown => {
    if (!n || typeof n !== "object") return n;
    const node = n as { type?: string; attrs?: { src?: string; alt?: string | null }; content?: unknown[] };
    if (node.type === "image" && node.attrs?.src && map.has(node.attrs.src)) {
      const to = map.get(node.attrs.src);
      if (to) return { ...node, attrs: { ...node.attrs, src: to } };
      const alt = node.attrs.alt;
      return { type: "paragraph", content: alt ? [{ type: "text", text: `[Image: ${alt}]` }] : [] };
    }
    return node.content ? { ...node, content: node.content.map(walk) } : node;
  };
  return walk(doc) as ChapterDoc;
}

const decode = (s: string): string => { try { return decodeURIComponent(s); } catch { return s; } };

/** Markdown references may be percent-encoded and carry `?query`/`#fragment`; try them as written first. */
const imageCandidates = (ref: string): string[] => [...new Set([ref, decode(ref.replace(/[?#].*$/, ""))])];

export interface LoadedSource { ext: string; bytes: Uint8Array }
export interface ChapterEdit { title: string; include: boolean }
/** What the wizard preview step chose. */
export interface ImportChoices { splitHeadingLevel?: 1 | 2 | 3; edits?: ChapterEdit[] }

/** Reads the source (read-only). Nothing is parsed yet. */
export async function loadImport(sourcePath: string): Promise<LoadedSource> {
  const ext = /\.([^.]+)$/.exec(baseName(sourcePath))?.[1]?.toLowerCase() ?? "";
  if (!["docx", "md", "markdown", "html", "htm", "txt"].includes(ext)) throw new Error(t`Choose a .docx, .md, .markdown or .html file.`);
  return { ext, bytes: await bridge.readImportSource(sourcePath) };
}

const decoderFor = (label: string): TextDecoder | null => { try { return new TextDecoder(label); } catch { return null; } };

/**
 * A text source as a string. A byte-order mark picks UTF-8 or UTF-16; an HTML file may name its charset in a `<meta>`
 * tag near the top; otherwise strict UTF-8, and bytes that are not valid UTF-8 are read as Windows-1252 (what an old
 * editor wrote) rather than turned into replacement characters. Throws for binary data.
 */
export function decodeText(bytes: Uint8Array, html = false): string {
  let text: string | null = null;
  const b = bytes;
  if (b[0] === 0xff && b[1] === 0xfe) text = new TextDecoder("utf-16le").decode(b.subarray(2));
  else if (b[0] === 0xfe && b[1] === 0xff) text = new TextDecoder("utf-16be").decode(b.subarray(2));
  else if (b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf) text = new TextDecoder("utf-8").decode(b.subarray(3));
  if (text === null && html) {
    const head = new TextDecoder("latin1").decode(b.subarray(0, 2048));
    const label = /<meta[^>]+charset\s*=\s*["']?\s*([\w:.-]+)/i.exec(head)?.[1];
    const d = label && !/^utf-?8$/i.test(label) ? decoderFor(label) : null;
    if (d) text = d.decode(b);
  }
  if (text === null) {
    try { text = new TextDecoder("utf-8", { fatal: true }).decode(b); } catch { text = new TextDecoder("windows-1252").decode(b); }
  }
  if (text.slice(0, 4096).includes("\u0000")) throw new Error(t`This file does not look like text. It may be damaged or saved in another format.`);
  return text.replace(/^\uFEFF/, "");
}

/** Parses a loaded source; pure, so the wizard can re-run it when the split level changes. */
export function parseImport(src: LoadedSource, splitHeadingLevel: 1 | 2 | 3 = 1): ImportResult {
  let result: ImportResult;
  try {
    const text = () => decodeText(src.bytes, src.ext === "html" || src.ext === "htm");
    result = src.ext === "docx" ? importDocx(src.bytes, { splitHeadingLevel })
      : src.ext === "html" || src.ext === "htm" ? importHtml(text(), { splitHeadingLevel })
      : importMarkdown(text(), { splitHeadingLevel });
  } catch (e) {
    if (e instanceof ImportError) throw new Error(describeImportError(e));
    // A stack overflow or out-of-range string from a pathological file: the same advice as for deep nesting.
    if (e instanceof RangeError) throw new Error(t`This file is too large or too deeply nested to import.`);
    throw e;
  }
  if (result.chapters.length === 0) throw new Error(t`There is no text to import in this file.`);
  return result;
}

/** Image sources used by a doc. */
function imageSources(doc: unknown, into = new Set<string>()): Set<string> {
  const n = doc as { type?: string; attrs?: { src?: string }; content?: unknown[] } | null;
  if (n?.type === "image" && n.attrs?.src) into.add(n.attrs.src);
  n?.content?.forEach((c) => imageSources(c, into));
  return into;
}

/** Applies the author's preview edits: skipped chapters are dropped (with the images only they used), blank titles keep the original. */
export function applyChapterEdits(result: ImportResult, edits: ChapterEdit[]): ImportResult {
  const chapters = result.chapters.flatMap((c, i) => {
    const e = edits[i];
    return e && !e.include ? [] : [{ ...c, title: e?.title.trim() || c.title }];
  });
  if (chapters.length === 0) throw new Error(t`Keep at least one chapter.`);
  const used = new Set<string>();
  for (const c of chapters) imageSources(c.doc, used);
  return { ...result, chapters, assets: result.assets.filter((a) => used.has(a.targetPath)) };
}

/** Parses and writes in one go (no preview). */
export async function runImport(opts: { sourcePath: string; root: string; title: string; author: string } & ImportChoices): Promise<ImportReport> {
  const result = parseImport(await loadImport(opts.sourcePath), opts.splitHeadingLevel);
  return writeImport({ ...opts, result: opts.edits ? applyChapterEdits(result, opts.edits) : result });
}

/** Loads images, and only then writes. Nothing is created when an image or the parse failed earlier; a later failure says what was written. */
export async function writeImport(opts: { sourcePath: string; root: string; title: string; author: string; result: ImportResult }): Promise<ImportReport> {
  const fileName = baseName(opts.sourcePath);
  const { result } = opts;

  // 2. Load images into memory (still no writes). A missing or refused image is a warning, not a failure.
  const warnings = [...result.warnings];
  const images: { target: string; name: string; bytes: Uint8Array }[] = [];
  for (const a of result.assets) {
    let data = a.bytes ?? null;
    let why = "";
    if (!data) {
      for (const candidate of imageCandidates(a.sourcePath)) {
        try { data = await bridge.readImportImage(opts.sourcePath, candidate); break; } catch (e) { why = errText(e); }
      }
    }
    if (data) images.push({ target: a.targetPath, name: baseName(a.targetPath), bytes: data });
    else warnings.push({ code: "image-not-imported", severity: "warning", message: t`Image ${a.sourcePath} could not be imported: ${why}`, examples: [a.sourcePath] });
  }

  // 3. Write. The manifest is written last with the chapter list, so an interrupted import never lists missing files.
  const written = { images: 0, chapters: 0 };
  const wrote = () => t`Already written to ${opts.root}: ${written.chapters} chapter files and ${written.images} images; the book's chapter list was not saved.`;
  try {
    let manifest = createManifest({ title: opts.title, author: opts.author, language: i18n.locale === "pseudo" ? "en" : i18n.locale, identifier: `urn:uuid:${crypto.randomUUID()}` });
    await bridge.createProject(opts.root, serializeManifest(manifest));
    const map = new Map<string, string | null>();
    for (const a of result.assets) map.set(a.targetPath, null);
    for (const img of images) {
      try {
        map.set(img.target, await bridge.importAssetBytes(opts.root, img.name, img.bytes));
        written.images++;
      } catch (e) {
        warnings.push({ code: "image-not-imported", severity: "warning", message: t`Image ${img.name} could not be stored: ${errText(e)}`, examples: [img.name] });
      }
    }
    for (const c of result.chapters) {
      const next = addChapter(manifest, c.title);
      manifest = next.manifest;
      await bridge.writeFile(opts.root, next.entry.file, JSON.stringify(remapImages(c.doc, map), null, 2), null);
      written.chapters++;
    }
    await bridge.writeFile(opts.root, "cadabra.json", serializeManifest(manifest), null);
  } catch (e) {
    throw new Error(`${errText(e)} ${wrote()}`);
  }
  return { fileName, title: opts.title, chapterCount: result.chapters.length, imageCount: written.images, warnings };
}

/** Default book title for a picked file: its name without the extension. */
export const titleFromFile = (path: string): string => stem(baseName(path)).replace(/[_-]+/g, " ").trim();
