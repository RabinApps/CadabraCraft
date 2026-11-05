import { t } from "@lingui/core/macro";
import { i18n } from "@lingui/core";
import {
  addChapter,
  createManifest,
  serializeManifest,
  sourceEdition,
  sourceFile,
  type Manifest,
} from "@cadabracraft/format";
import {
  ImportError,
  importHtml,
  importMarkdown,
  type ImportResult,
  type ImportWarning,
} from "@cadabracraft/import-docx";
import {
  OutlineError,
  outlineFormatOfFile,
  outlineToPages,
  parseOutline,
  type OutlineImportFormat,
} from "@cadabracraft/outline";
import type { ChapterDoc } from "@cadabracraft/shared";
import { bridge } from "./bridge";
import { baseName, stem } from "./paths";
import { decodeDocxImport } from "./docxFrame";
import { describeImportCode, describeOutlineCode } from "./importErrorText";
import { newSceneId } from "./scenes";
import { errText, isProjectError, whyText } from "./projectError";
import { applyPlan, type ImportPlan } from "./importPlan";

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
    if (!g)
      groups.set(
        w.code,
        (g = { code: w.code, severity: w.severity, count: 0, message: w.message, examples: [] }),
      );
    if (w.severity === "warning") g.severity = "warning";
    g.count += w.count ?? 1;
    const ex = [
      ...(w.examples ?? []),
      ...(w.examples?.length ? [] : [w.line ? `${w.message} (line ${w.line})` : w.message]),
    ];
    for (const e of ex) if (g.examples.length < 3 && !g.examples.includes(e)) g.examples.push(e);
  }
  // Warnings (content lost) before info (benign), then most frequent first.
  return [...groups.values()].sort(
    (a, b) =>
      Number(b.severity === "warning") - Number(a.severity === "warning") || b.count - a.count,
  );
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

/** Replaces image sources per `map` (null removes the image and leaves its alt text), without mutating the input. */
export function remapImages(doc: ChapterDoc, map: Map<string, string | null>): ChapterDoc {
  const walk = (n: unknown): unknown => {
    if (!n || typeof n !== "object") return n;
    const node = n as {
      type?: string;
      attrs?: { src?: string; alt?: string | null };
      content?: unknown[];
    };
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

const decode = (s: string): string => {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
};

/** Markdown references may be percent-encoded and carry `?query`/`#fragment`; try them as written first. */
const imageCandidates = (ref: string): string[] => [
  ...new Set([ref, decode(ref.replace(/[?#].*$/, ""))]),
];

export interface LoadedSource {
  ext: string;
  /** The file's bytes. Empty for a `.docx`: the Rust importer reads the file itself, from `path`. */
  bytes: Uint8Array;
  /** The picked path; only a `.docx` is parsed from it (see `parseImport`). */
  path?: string;
}
export interface ChapterEdit {
  title: string;
  include: boolean;
}
/** What the wizard preview step chose. */
export interface ImportChoices {
  splitHeadingLevel?: 1 | 2 | 3;
  /** Read the file as an outline of chapters and scenes (always for `.opml` and `.csv`; the author's choice for Markdown). */
  outline?: boolean;
  edits?: ChapterEdit[];
  /** Reorder, merge, rename and skip decisions; takes precedence over `edits`. */
  plan?: ImportPlan;
}

/** Reads the source (read-only). Nothing is parsed yet; a `.docx` is not even read here (Rust unzips and parses it in `parseImport`). */
export async function loadImport(sourcePath: string): Promise<LoadedSource> {
  const ext = /\.([^.]+)$/.exec(baseName(sourcePath))?.[1]?.toLowerCase() ?? "";
  if (!["docx", "md", "markdown", "html", "htm", "txt", "opml", "csv"].includes(ext))
    throw new Error(t`Choose a .docx, .md, .markdown, .html, .opml or .csv file.`);
  if (ext === "docx") return { ext, bytes: new Uint8Array(), path: sourcePath };
  return { ext, bytes: await bridge.readImportSource(sourcePath) };
}

const decoderFor = (label: string): TextDecoder | null => {
  try {
    return new TextDecoder(label);
  } catch {
    return null;
  }
};

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
  else if (b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf)
    text = new TextDecoder("utf-8").decode(b.subarray(3));
  if (text === null && html) {
    const head = new TextDecoder("latin1").decode(b.subarray(0, 2048));
    const label = /<meta[^>]+charset\s*=\s*["']?\s*([\w:.-]+)/i.exec(head)?.[1];
    const d = label && !/^utf-?8$/i.test(label) ? decoderFor(label) : null;
    if (d) text = d.decode(b);
  }
  if (text === null) {
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(b);
    } catch {
      text = new TextDecoder("windows-1252").decode(b);
    }
  }
  if (text.slice(0, 4096).includes("\u0000"))
    throw new Error(
      t`This file does not look like text. It may be damaged or saved in another format.`,
    );
  return text.replace(/^\uFEFF/, "");
}

/** Turns an importer failure into the sentence the author sees. */
function importFailure(e: unknown): unknown {
  if (e instanceof ImportError) return new Error(describeImportCode(e.code), { cause: e });
  // A stack overflow or out-of-range string from a pathological file: the same advice as for deep nesting.
  if (e instanceof RangeError)
    return new Error(t`This file is too large or too deeply nested to import.`, { cause: e });
  return e;
}

/** Parses a Markdown, HTML or text source; pure, so the wizard can re-run it when the split level changes. */
export function parseText(src: LoadedSource, splitHeadingLevel: 1 | 2 | 3 = 1): ImportResult {
  let result: ImportResult;
  try {
    const text = () => decodeText(src.bytes, src.ext === "html" || src.ext === "htm");
    result =
      src.ext === "html" || src.ext === "htm"
        ? importHtml(text(), { splitHeadingLevel })
        : importMarkdown(text(), { splitHeadingLevel });
  } catch (e) {
    throw importFailure(e);
  }
  if (result.chapters.length === 0) throw new Error(t`There is no text to import in this file.`);
  return result;
}

/** An outline file is always an outline; a Markdown file is one only when the author says so; anything else is a manuscript. */
export function outlineFormatFor(
  src: LoadedSource,
  asOutline: boolean,
): OutlineImportFormat | null {
  const format = outlineFormatOfFile(`x.${src.ext}`);
  return format === "markdown" && !asOutline ? null : format;
}

/** The number of scenes in a chapter document (the scene wrappers directly under the document). */
export const sceneCountOf = (doc: ChapterDoc): number =>
  doc.content.filter((n) => n.type === "scene").length;

/**
 * Reads an outline file as chapters with scenes (OPML, CSV or Markdown), in the webview: pure and read-only. Every scene
 * gets a new id, so importing it twice into one book never makes two scenes with the same id. What the file could not
 * keep (a bad status, a cast) comes back as warnings the import report lists.
 */
export function parseOutlineSource(src: LoadedSource, format: OutlineImportFormat): ImportResult {
  try {
    const parsed = parseOutline(decodeText(src.bytes), format);
    const { pages, warnings } = outlineToPages(parsed, newSceneId, t`Untitled`);
    return {
      chapters: pages.map(({ title, doc }) => ({ title, doc })),
      warnings: warnings.map((w) => ({
        code: `outline-${w.code}`,
        severity: "warning" as const,
        message: w.message,
      })),
      assets: [],
    };
  } catch (e) {
    throw e instanceof OutlineError ? new Error(describeOutlineCode(e.code), { cause: e }) : e;
  }
}

/**
 * Parses a loaded source; the wizard re-runs it when the split level or the way of reading it changes. A `.docx` is
 * parsed in Rust (the `import_docx_source` command: unzip with limits, XML, mapping to chapters, all on the blocking
 * pool), everything else in the webview. All give the same `ImportResult`.
 */
export async function parseImport(
  src: LoadedSource,
  splitHeadingLevel: 1 | 2 | 3 = 1,
  outline = false,
): Promise<ImportResult> {
  const format = outlineFormatFor(src, outline);
  if (format) return parseOutlineSource(src, format);
  if (src.ext !== "docx") return parseText(src, splitHeadingLevel);
  let result: ImportResult;
  try {
    result = decodeDocxImport(await bridge.importDocxSource(src.path ?? "", splitHeadingLevel));
  } catch (e) {
    throw isProjectError(e) && e.kind === "import_docx"
      ? new Error(describeImportCode(e.code), { cause: e })
      : e;
  }
  if (result.chapters.length === 0) throw new Error(t`There is no text to import in this file.`);
  return result;
}

/** Applies the author's preview edits: skipped chapters are dropped (with the images only they used), blank titles keep the original. */
export function applyChapterEdits(result: ImportResult, edits: ChapterEdit[]): ImportResult {
  const plan = result.chapters.map((c, i) => ({
    sources: [i],
    title: edits[i]?.title ?? c.title,
    include: edits[i]?.include ?? true,
  }));
  return applyPlan(result, plan, t`Keep at least one chapter.`);
}

/** The parsed chapters the author chose, in the order they chose: from the plan when there is one, else from the plain edits. */
export function chosenChapters(result: ImportResult, opts: ImportChoices): ImportResult {
  if (opts.plan) return applyPlan(result, opts.plan, t`Keep at least one chapter.`);
  return opts.edits ? applyChapterEdits(result, opts.edits) : result;
}

/** Parses and writes in one go (no preview). */
export async function runImport(
  opts: { sourcePath: string; root: string; title: string; author: string } & ImportChoices,
): Promise<ImportReport> {
  const result = await parseImport(
    await loadImport(opts.sourcePath),
    opts.splitHeadingLevel,
    opts.outline,
  );
  return writeImport({ ...opts, result: chosenChapters(result, opts) });
}

type LoadedImage = { target: string; name: string; bytes: Uint8Array };

/** Loads the images into memory (no writes). A missing or refused image becomes a warning, not a failure. */
async function readImages(
  sourcePath: string,
  result: ImportResult,
  warnings: ImportWarning[],
): Promise<LoadedImage[]> {
  const images: LoadedImage[] = [];
  for (const a of result.assets) {
    let data = a.bytes ?? null;
    let why = "";
    if (!data) {
      for (const candidate of imageCandidates(a.sourcePath)) {
        try {
          data = await bridge.readImportImage(sourcePath, candidate);
          break;
        } catch (e) {
          why = whyText(e);
        }
      }
    }
    if (data) images.push({ target: a.targetPath, name: baseName(a.targetPath), bytes: data });
    else
      warnings.push({
        code: "image-not-imported",
        severity: "warning",
        message: t`Image ${a.sourcePath} could not be imported: ${why}. Add the picture to the page yourself after the import.`,
        examples: [a.sourcePath],
      });
  }
  return images;
}

/**
 * Stores the images (never replacing a file: the Rust side picks a free name or reuses identical bytes), then writes
 * one new chapter file per imported chapter and adds it to `start`. Returns the grown manifest; saving it is the
 * caller's last step, so an interrupted import never lists missing files. `written` counts what is on disk if this throws.
 */
async function writeBody(
  root: string,
  start: Manifest,
  result: ImportResult,
  images: LoadedImage[],
  warnings: ImportWarning[],
  written: { images: number; chapters: number },
): Promise<Manifest> {
  let manifest = start;
  const map = new Map<string, string | null>();
  for (const a of result.assets) map.set(a.targetPath, null);
  for (const img of images) {
    try {
      map.set(img.target, await bridge.importAssetBytes(root, img.name, img.bytes));
      written.images++;
    } catch (e) {
      warnings.push({
        code: "image-not-imported",
        severity: "warning",
        message: t`Image ${img.name} could not be stored: ${whyText(e)}. Add the picture to the page yourself after the import.`,
        examples: [img.name],
      });
    }
  }
  for (const c of result.chapters) {
    const next = addChapter(manifest, c.title);
    manifest = next.manifest;
    await bridge.writeFile(
      root,
      sourceFile(next.entry, manifest.editions),
      JSON.stringify(remapImages(c.doc, map), null, 2),
      null,
    );
    written.chapters++;
  }
  return manifest;
}

/** Loads images, and only then writes. Nothing is created when an image or the parse failed earlier; a later failure says what was written. */
export async function writeImport(opts: {
  sourcePath: string;
  root: string;
  title: string;
  author: string;
  result: ImportResult;
}): Promise<ImportReport> {
  const fileName = baseName(opts.sourcePath);
  const { result } = opts;
  const warnings = [...result.warnings];
  const images = await readImages(opts.sourcePath, result, warnings);

  // The manifest is written last with the chapter list, so an interrupted import never lists missing files.
  const written = { images: 0, chapters: 0 };
  const wrote = () =>
    t`Already written to ${opts.root}: ${written.chapters} chapter files and ${written.images} images; the book's chapter list was not saved.`;
  try {
    const manifest = createManifest({
      title: opts.title,
      author: opts.author,
      language: i18n.locale === "pseudo" ? "en" : i18n.locale,
      identifier: `urn:uuid:${crypto.randomUUID()}`,
    });
    await bridge.createProject(opts.root, serializeManifest(manifest));
    const grown = await writeBody(opts.root, manifest, result, images, warnings, written);
    await bridge.writeFile(opts.root, "cadabra.json", serializeManifest(grown), null);
  } catch (e) {
    throw new Error(`${errText(e)} ${wrote()}`, { cause: e });
  }
  return {
    fileName,
    title: opts.title,
    chapterCount: result.chapters.length,
    imageCount: written.images,
    warnings,
  };
}

/**
 * Appends the chosen chapters of a source to an open book. Existing chapters are never touched: images and chapter
 * files get new names, and the manifest is saved last through `saveManifest` (which backs it up and checks the on-disk
 * hash like every other manifest save). Nothing is written when the parse or an image read failed earlier.
 * Resolves to the report and the id of the first new chapter.
 */
export async function runImportInto(
  opts: {
    sourcePath: string;
    root: string;
    manifest: Manifest;
    saveManifest: (m: Manifest) => Promise<void>;
  } & ImportChoices,
): Promise<{ report: ImportReport; firstId: string }> {
  const loaded = await parseImport(
    await loadImport(opts.sourcePath),
    opts.splitHeadingLevel,
    opts.outline,
  );
  const result = chosenChapters(loaded, opts);
  const warnings = [...result.warnings];
  const images = await readImages(opts.sourcePath, result, warnings);
  const written = { images: 0, chapters: 0 };
  let grown: Manifest;
  try {
    grown = await writeBody(opts.root, opts.manifest, result, images, warnings, written);
    await opts.saveManifest(grown);
  } catch (e) {
    throw new Error(
      `${errText(e)} ${t`${written.chapters} new chapter files and ${written.images} images were stored in the book folder, but the chapter list was not changed.`}`,
      { cause: e },
    );
  }
  const report: ImportReport = {
    fileName: baseName(opts.sourcePath),
    title: sourceEdition(opts.manifest.editions).title,
    chapterCount: result.chapters.length,
    imageCount: written.images,
    warnings,
  };
  return { report, firstId: grown.chapters[opts.manifest.chapters.length]?.id ?? "" };
}

/** Default book title for a picked file: its name without the extension. */
export const titleFromFile = (path: string): string =>
  stem(baseName(path)).replace(/[_-]+/g, " ").trim();
