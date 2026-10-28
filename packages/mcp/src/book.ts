// Loads a whole book (manifest, chapter docs, image bytes) for the exporters, like loadChapters/loadAssets in the app store.
import {
  FormatError,
  entryFile,
  exportDir,
  exportPlan,
  sourceTitle,
  type Edition,
  type EditionEntry,
  type Manifest,
} from "@cadabracraft/format";
import { ProjectFsError, imageExt, looksLike, readAsset } from "@cadabracraft/project-fs";
import { DEFAULT_TEMPLATE_ID, hasTemplate } from "@cadabracraft/templates";
import { isAssetPath, type ChapterDoc } from "@cadabracraft/shared";
import { isChapterDoc } from "@cadabracraft/editor-schema";
import { imageSources, schemaProblem } from "./doc";
import { ToolError } from "./errors";
import { editionOf, loadProject, readChapterFile } from "./project";
import type { Ctx } from "./tooling";

export interface Book {
  root: string;
  manifest: Manifest;
  /** The edition being exported (the source unless a language was asked for). */
  edition: Edition;
  /** `exports/<language>`: where this edition's files go. */
  dir: string;
  /** Pages left out because they are not translated yet (only with `skipUntranslated`). */
  skipped: EditionEntry[];
  chapters: { id: string; title: string; doc: ChapterDoc }[];
  /** Image bytes keyed by the project-relative `assets/<name>` path used in the chapters. */
  assets: Map<string, Uint8Array>;
  /** The manifest's template if it exists, else the default (as the app does). */
  templateId: string;
}

export interface ExportScope {
  language?: string | undefined;
  skipUntranslated?: boolean | undefined;
}

/** Reads every page of one edition in reading order and the images they use. Throws before any export work starts. */
export function loadBook(ctx: Ctx, path: string, scope: ExportScope = {}): Book {
  const { root, manifest } = loadProject(ctx, path);
  const edition = editionOf(manifest, scope.language);
  let plan;
  try {
    plan = exportPlan(manifest, edition.language, scope.skipUntranslated === true);
  } catch (e) {
    if (e instanceof FormatError)
      throw new ToolError(
        "chapter_not_translated",
        `${e.message}. Write them with cadabra_chapter_write_json/markdown (language "${edition.language}") or pass skipUntranslated.`,
      );
    throw e;
  }
  const entries = plan.included;
  if (entries.length === 0)
    throw new ToolError("empty_book", "the book has no chapters; add one with cadabra_chapter_add");
  const chapters = entries.map((e) => {
    const file = entryFile(e, edition.language)!; // exportPlan only includes pages that have a file in this language
    const { doc } = readChapterFile(root, file);
    if (!isChapterDoc(doc))
      throw new ToolError(
        "invalid_chapter_doc",
        `${file} is not valid in the editor schema: ${schemaProblem(doc)}`,
      );
    return {
      id: e.id,
      title: e.titles[edition.language] ?? sourceTitle(e, manifest.editions),
      doc,
    };
  });
  const assets = new Map<string, Uint8Array>();
  for (const src of chapters.flatMap((c) => imageSources(c.doc))) {
    if (assets.has(src)) continue;
    const ext = imageExt(src);
    if (!isAssetPath(src) || !ext)
      throw new ToolError(
        "invalid_chapter_doc",
        `image source "${src}" is not a project-relative assets/<image> path`,
      );
    let bytes: Uint8Array;
    try {
      bytes = readAsset(root, src);
    } catch (e) {
      if (e instanceof ProjectFsError && e.code === "not_found")
        throw new ToolError("asset_missing", `image file ${src} is missing`, { assets: [src] });
      throw e;
    }
    if (!looksLike(ext, bytes))
      throw new ToolError("invalid_image", `${src} is not a valid ${ext} image`);
    assets.set(src, bytes);
  }
  return {
    root,
    manifest,
    edition,
    dir: exportDir(edition.language),
    skipped: plan.skipped,
    chapters,
    assets,
    templateId: hasTemplate(manifest.template) ? manifest.template : DEFAULT_TEMPLATE_ID,
  };
}
