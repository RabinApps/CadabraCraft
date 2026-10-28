// Loads a whole book (manifest, chapter docs, image bytes) for the exporters, like loadChapters/loadAssets in the app store.
import { readingOrder, sourceFile, sourceTitle, type Manifest } from "@cadabracraft/format";
import { ProjectFsError, imageExt, looksLike, readAsset } from "@cadabracraft/project-fs";
import { DEFAULT_TEMPLATE_ID, hasTemplate } from "@cadabracraft/templates";
import { isAssetPath, type ChapterDoc } from "@cadabracraft/shared";
import { isChapterDoc } from "@cadabracraft/editor-schema";
import { imageSources, schemaProblem } from "./doc";
import { ToolError } from "./errors";
import { loadProject, readChapterFile } from "./project";
import type { Ctx } from "./tooling";

export interface Book {
  root: string;
  manifest: Manifest;
  chapters: { id: string; title: string; doc: ChapterDoc }[];
  /** Image bytes keyed by the project-relative `assets/<name>` path used in the chapters. */
  assets: Map<string, Uint8Array>;
  /** The manifest's template if it exists, else the default (as the app does). */
  templateId: string;
}

/** Reads every chapter in reading order and the images they use. Throws before any export work starts. */
export function loadBook(ctx: Ctx, path: string): Book {
  const { root, manifest } = loadProject(ctx, path);
  const entries = readingOrder(manifest);
  if (entries.length === 0)
    throw new ToolError("empty_book", "the book has no chapters; add one with cadabra_chapter_add");
  const chapters = entries.map((e) => {
    const file = sourceFile(e, manifest.editions);
    const { doc } = readChapterFile(root, file);
    if (!isChapterDoc(doc))
      throw new ToolError(
        "invalid_chapter_doc",
        `${file} is not valid in the editor schema: ${schemaProblem(doc)}`,
      );
    return { id: e.id, title: sourceTitle(e, manifest.editions), doc };
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
    chapters,
    assets,
    templateId: hasTemplate(manifest.template) ? manifest.template : DEFAULT_TEMPLATE_ID,
  };
}
