import { t } from "@lingui/core/macro";
import {
  exportDir,
  exportPlan,
  readingOrder,
  type Manifest,
  type EditionEntry,
  entryFile,
  sourceEdition,
} from "@cadabracraft/format";
import { collectImageSources } from "@cadabracraft/export-epub";
import type { ChapterDoc } from "@cadabracraft/shared";
import { bridge } from "../../../lib/bridge";
import { emptyDoc, parseChapter } from "../util";
import type { BookPage } from "../types";
import type { Get } from "../context";
import { createWords } from "./words";

/** Everything that reads the open book from disk: pages, word counts, images and the cover. */
export function createReads(
  get: Get,
  need: () => { root: string; manifest: Manifest },
  langOf: (manifest: Manifest) => string,
  titleIn: (entry: EditionEntry, manifest: Manifest, language: string) => string,
) {
  /** Every page of one language in reading order (front matter, chapters, back matter), read from disk (only page `only` when given). A page with no file yet is blank. */
  const loadChaptersIn = async (lang: string, only?: string) => {
    const { root, manifest } = need();
    const pages = [];
    const sectionFor = (e: EditionEntry): BookPage["section"] =>
      manifest.frontMatter.some((f) => f.id === e.id)
        ? "front"
        : manifest.backMatter.some((b) => b.id === e.id)
          ? "back"
          : "chapter";
    for (const c of readingOrder(manifest)) {
      if (only !== undefined && c.id !== only) continue;
      const file = entryFile(c, lang);
      const r = file ? await bridge.readFile(root, file) : null;
      if (file && !r) throw new Error(t`Missing chapter file ${file}`);
      const dropCap = sectionFor(c) === "chapter" ? (c.dropCap ?? manifest.dropCap) : undefined;
      pages.push({
        id: c.id,
        title: titleIn(c, manifest, lang),
        doc: r && file ? parseChapter(r.contents, file) : emptyDoc(titleIn(c, manifest, lang)),
        section: sectionFor(c),
        ...(c.kind ? { kind: c.kind } : {}),
        ...(dropCap === undefined ? {} : { dropCap }),
        ...(c.verticalCenter === undefined ? {} : { verticalCenter: c.verticalCenter }),
        ...(c.startOnNext === undefined ? {} : { startOnNext: c.startOnNext }),
      });
    }
    return pages;
  };
  /** The source edition's pages (audiobook and find and replace all read the source for now). */
  const loadChapters = () => loadChaptersIn(sourceEdition(need().manifest.editions).language);
  /**
   * What an export of `language` (default: the source) reads: its edition, its pages and the output folder.
   * Untranslated pages stop the export unless `skipUntranslated`; then they are left out and listed in `skipped`.
   */
  const loadExportPages = async (scope: { language?: string; skipUntranslated?: boolean } = {}) => {
    const { manifest } = need();
    const language = scope.language ?? sourceEdition(manifest.editions).language;
    const plan = exportPlan(manifest, language, scope.skipUntranslated ?? false);
    const keep = new Set(plan.included.map((e) => e.id));
    const pages = (await loadChaptersIn(language)).filter((p) => keep.has(p.id));
    const edition = manifest.editions.find((e) => e.language === language)!;
    return { edition, pages, dir: exportDir(language), skipped: plan.skipped };
  };
  /** Bytes of every image the chapters use. */
  const loadAssets = async (chapters: { doc: ChapterDoc }[]) => {
    const { root } = need();
    const assets = new Map<string, Uint8Array>();
    for (const src of chapters.flatMap((c) => collectImageSources(c.doc))) {
      if (assets.has(src)) continue;
      try {
        assets.set(src, await bridge.readAsset(root, src));
      } catch {
        throw new Error(t`Missing image file ${src}`);
      }
    }
    return assets;
  };

  /** Bytes of the cover image, or undefined when the book has none. A cover that cannot be read stops the export instead of leaving it out. */
  const loadCover = async (
    cover: string | null,
  ): Promise<{ path: string; bytes: Uint8Array } | undefined> => {
    const { root } = need();
    if (!cover) return undefined;
    try {
      return { path: cover, bytes: await bridge.readAsset(root, cover) };
    } catch {
      throw new Error(
        t`The cover image ${cover} could not be read. Choose it again in Book details, or remove the cover.`,
      );
    }
  };
  const { countBook, countEntries, resetWordCache, forgetWords } = createWords(get, need, langOf);
  return {
    loadChapters,
    loadChaptersIn,
    loadExportPages,
    countBook,
    countEntries,
    loadAssets,
    loadCover,
    resetWordCache,
    forgetWords,
  };
}
