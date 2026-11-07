import { t } from "@lingui/core/macro";
import { i18n } from "@lingui/core";
import {
  createManifest,
  insertChaptersAt,
  serializeManifest,
  sourceEdition,
  sourceFile,
  type EditionEntry,
  type Manifest,
} from "@cadabracraft/format";
import type { ImportResult, ImportWarning } from "@cadabracraft/import-docx";
import { bridge } from "../bridge";
import { baseName } from "../paths";
import { errText, whyText } from "../projectError";
import {
  chosenChapters,
  imageCandidates,
  loadImport,
  parseImport,
  remapImages,
  type ImportChoices,
  type ImportReport,
} from "./importBook";

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

/** A chapter an import added: its manifest entry and its (source-language) file, project-relative. */
export interface CreatedChapter {
  entry: EditionEntry;
  file: string;
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
  sink: { warnings: ImportWarning[]; written: { images: number; chapters: number }; at?: number },
): Promise<{ manifest: Manifest; created: CreatedChapter[] }> {
  const { warnings, written, at = start.chapters.length } = sink;
  let manifest = start;
  const created: CreatedChapter[] = [];
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
    const next = insertChaptersAt(manifest, [c.title], at + created.length);
    manifest = next.manifest;
    const entry = next.entries[0]!;
    const file = sourceFile(entry, manifest.editions);
    await bridge.writeFile(root, file, JSON.stringify(remapImages(c.doc, map), null, 2), null);
    created.push({ entry, file });
    written.chapters++;
  }
  return { manifest, created };
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
    const grown = await writeBody(opts.root, manifest, result, images, { warnings, written });
    await bridge.writeFile(opts.root, "cadabra.json", serializeManifest(grown.manifest), null);
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
 * The chapters go at `insertAt` of the chapters list (default: the end; part dividers are positional, so they join the
 * part that position falls in). Resolves to the report, the id of the first new chapter and the created chapters
 * (entries and files), which the caller records for undo. Images stay in assets/ (undo does not remove them: a
 * stored picture may be shared by identical bytes, and an unused asset is harmless).
 */
export async function runImportInto(
  opts: {
    sourcePath: string;
    root: string;
    manifest: Manifest;
    saveManifest: (m: Manifest) => Promise<void>;
  } & ImportChoices,
): Promise<{ report: ImportReport; firstId: string; created: CreatedChapter[] }> {
  const loaded = await parseImport(
    await loadImport(opts.sourcePath),
    opts.splitHeadingLevel,
    opts.outline,
  );
  const result = chosenChapters(loaded, opts);
  const warnings = [...result.warnings];
  const images = await readImages(opts.sourcePath, result, warnings);
  const written = { images: 0, chapters: 0 };
  let created: CreatedChapter[];
  try {
    const body = await writeBody(opts.root, opts.manifest, result, images, {
      warnings,
      written,
      at: opts.insertAt,
    });
    created = body.created;
    await opts.saveManifest(body.manifest);
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
  return { report, firstId: created[0]?.entry.id ?? "", created };
}
