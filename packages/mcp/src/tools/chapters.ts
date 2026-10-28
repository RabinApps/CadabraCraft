import { z } from "zod";
import { addChapter, entryFile, markTranslated, moveChapter, removeChapter, renameChapter, renameIn, setTranslationFile, sourceFile, sourceTitle, translationFile, type Edition, type EditionEntry, type Manifest } from "@cadabracraft/format";
import { importMarkdown, type ImportWarning } from "@cadabracraft/import-docx";
import { ProjectFsError, backupFile, countWords, imageExt, looksLike, readAsset, readProjectFile, trashFile, writeProjectFile } from "@cadabracraft/project-fs";
import { isAssetPath, type ChapterDoc } from "@cadabracraft/shared";
import { badImageSources, docToText, emptyChapterDoc, remapImages, schemaProblem } from "../doc";
import { ToolError } from "../errors";
import { editionOf, findEntry, loadProject, projectRoot, readChapterFile, saveManifest } from "../project";
import { type ToolDef, defineTool, withLock } from "../tooling";
import { PATH } from "./project";

const CHAPTER_ID = z.string().min(1).describe("Chapter id from cadabra_project_info (e.g. ch-1).");
const BASE_HASH = z.string().regex(/^[0-9a-f]{64}$/).optional().describe("hash from cadabra_chapter_read. If the file changed on disk since then, that version is kept as a .conflict- copy before yours is written.");

const LANGUAGE = z.string().min(1).optional().describe("Edition (language code from cadabra_project_info); default is the source edition.");

/** The entry's title and file in `language` (the source edition when undefined); the file is undefined while that language has no text for it yet. */
const brief = (e: EditionEntry, editions: Edition[], language?: string) => {
  const lang = language ?? editions[0]!.language;
  return { id: e.id, title: e.titles[lang] ?? sourceTitle(e, editions), file: entryFile(e, lang) ?? sourceFile(e, editions) };
};
const isSource = (m: Manifest, language: string): boolean => language === m.editions[0]!.language;
const json = (doc: unknown): string => JSON.stringify(doc, null, 2);

export const chapterAdd = defineTool({
  name: "cadabra_chapter_add",
  title: "Add chapter",
  description: "Append a chapter (heading plus an empty paragraph) at the end of the book. The chapter file is written first, then the manifest.",
  input: { path: PATH, title: z.string().min(1).describe("Chapter title.") },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
  run: ({ path, title }, ctx) =>
    withLock(projectRoot(ctx, path), () => {
      const { root, manifest, hash } = loadProject(ctx, path);
      const { manifest: next, entry } = addChapter(manifest, title);
      const file = sourceFile(entry, next.editions);
      if (readProjectFile(root, file)) throw new ToolError("io_error", `${file} already exists on disk but is not listed in the book; refusing to overwrite it`);
      writeProjectFile(root, file, json(emptyChapterDoc(title)));
      const w = saveManifest(root, next, hash);
      return { summary: `Added chapter ${entry.id} "${title}" (${file})`, data: { chapter: brief(entry, next.editions), position: next.chapters.length, manifestHash: w.hash, conflictCopy: w.conflictCopy } };
    }),
});

export const chapterRename = defineTool({
  name: "cadabra_chapter_rename",
  title: "Rename chapter",
  description: "Change a chapter's title in the manifest (in one edition when language is given). The file keeps its name and its content (including its heading) is not changed.",
  input: { path: PATH, chapterId: CHAPTER_ID, title: z.string().min(1).describe("New title."), language: LANGUAGE },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
  run: ({ path, chapterId, title, language }, ctx) =>
    withLock(projectRoot(ctx, path), () => {
      const { root, manifest, hash } = loadProject(ctx, path);
      const lang = editionOf(manifest, language).language;
      const next = chaptersOnly(() => (isSource(manifest, lang) ? renameChapter(manifest, chapterId, title) : (findEntry(manifest, chapterId), renameIn(manifest, chapterId, lang, title))), chapterId);
      saveManifest(root, next, hash);
      const chapter = findEntry(next, chapterId).entry;
      return { summary: `Renamed ${chapterId} to "${title}"${isSource(manifest, lang) ? "" : ` (${lang})`}`, data: { chapter: brief(chapter, manifest.editions, lang) } };
    }),
});

export const chapterMove = defineTool({
  name: "cadabra_chapter_move",
  title: "Move chapter",
  description: "Move a chapter earlier (negative delta) or later (positive) in the reading order, clamped to the ends. File names do not change.",
  input: { path: PATH, chapterId: CHAPTER_ID, delta: z.number().int().describe("Positions to move: -1 = one earlier, 2 = two later.") },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
  run: ({ path, chapterId, delta }, ctx) =>
    withLock(projectRoot(ctx, path), () => {
      const { root, manifest, hash } = loadProject(ctx, path);
      const next = chaptersOnly(() => moveChapter(manifest, chapterId, delta), chapterId);
      saveManifest(root, next, hash);
      const position = next.chapters.findIndex((c) => c.id === chapterId) + 1;
      return { summary: `Moved ${chapterId} to position ${position}`, data: { position, order: next.chapters.map((c) => ({ id: c.id, title: sourceTitle(c, next.editions) })) } };
    }),
});

export const chapterRemove = defineTool({
  name: "cadabra_chapter_remove",
  title: "Remove chapter",
  description: "Remove a chapter from the book. The manifest is saved first, then the chapter's files (the source text and every translation) are moved to .cadabra/trash/ (never deleted), so the text can be recovered.",
  input: { path: PATH, chapterId: CHAPTER_ID },
  annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
  run: ({ path, chapterId }, ctx) =>
    withLock(projectRoot(ctx, path), () => {
      const { root, manifest, hash } = loadProject(ctx, path);
      const { manifest: next, removed } = chaptersOnly(() => removeChapter(manifest, chapterId), chapterId);
      saveManifest(root, next, hash);
      const trashedFiles: Record<string, string> = {};
      for (const [language, file] of Object.entries(removed.files)) {
        try {
          trashedFiles[language] = trashFile(root, file);
        } catch (e) {
          if (!(e instanceof ProjectFsError && e.code === "not_found")) throw e;
        }
      }
      const trashedTo = trashedFiles[manifest.editions[0]!.language] ?? null;
      const n = Object.keys(trashedFiles).length;
      return { summary: `Removed ${chapterId} "${sourceTitle(removed, manifest.editions)}"${n ? `; ${n} file(s) moved to .cadabra/trash/` : " (its file was already missing)"}`, data: { removed: brief(removed, manifest.editions), trashedTo, trashedFiles } };
    }),
});

/** The pure format edits throw a plain Error for an unknown id; report that with a stable code. */
function chaptersOnly<T>(fn: () => T, id: string): T {
  try {
    return fn();
  } catch (e) {
    if (e instanceof Error && e.message === `no chapter ${id}`) throw new ToolError("chapter_not_found", `no chapter with id "${id}" in the chapter list`);
    throw e;
  }
}

export const chapterRead = defineTool({
  name: "cadabra_chapter_read",
  title: "Read chapter",
  description: "Read one chapter (front matter, chapters and back matter): its TipTap JSON, plain text, word count and the content hash to use as baseHash when writing.",
  input: { path: PATH, chapterId: CHAPTER_ID, language: LANGUAGE },
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
  run: ({ path, chapterId, language }, ctx) => {
    const { root, manifest } = loadProject(ctx, path);
    const lang = editionOf(manifest, language).language;
    const { entry, section } = findEntry(manifest, chapterId);
    const file = entryFile(entry, lang);
    if (!file) throw new ToolError("chapter_not_translated", `${chapterId} has no text in "${lang}" yet; write it with cadabra_chapter_write_json or cadabra_chapter_write_markdown (language "${lang}")`);
    const { doc, hash } = readChapterFile(root, file);
    const words = countWords(doc);
    const translated = isSource(manifest, lang) || !(entry.untranslated ?? []).includes(lang);
    return { summary: `${brief(entry, manifest.editions, lang).title}: ${words} words${translated ? "" : " (not translated yet: a copy or blank page)"}`, data: { chapter: { ...brief(entry, manifest.editions, lang), section, language: lang, translated }, doc, text: docToText(doc), words, hash } };
  },
});

/** Where a write for `language` goes. A translation with no file yet gets the path next to the source file; `commit` records it and marks the page translated once the file is written. */
function writeTarget(manifest: Manifest, entry: EditionEntry, language: string): { file: string; commit: (m: Manifest) => Manifest | null } {
  if (isSource(manifest, language)) return { file: sourceFile(entry, manifest.editions), commit: () => null };
  const existing = entryFile(entry, language);
  const file = existing ?? translationFile(sourceFile(entry, manifest.editions), language);
  return {
    file,
    commit: (m) => {
      let next = existing ? m : setTranslationFile(m, entry.id, language, file);
      next = markTranslated(next, entry.id, language);
      return JSON.stringify(next) === JSON.stringify(m) ? null : next;
    },
  };
}

interface Written {
  hash: string;
  conflictCopy: string | null;
  backup: string | null;
}

/** Replaces a chapter file. The previous version is kept: as a conflict copy when baseHash shows it changed outside, else as a backup. */
function replaceChapter(root: string, file: string, doc: unknown, baseHash: string | undefined): Written {
  const text = json(doc);
  const existing = readProjectFile(root, file);
  const conflicts = !!(baseHash && existing && existing.hash !== baseHash);
  const backup = existing && !conflicts && existing.contents !== text ? backupFile(root, file) : null;
  const w = writeProjectFile(root, file, text, baseHash);
  return { hash: w.hash, conflictCopy: w.conflictCopy, backup };
}

export const chapterWriteJson = defineTool({
  name: "cadabra_chapter_write_json",
  title: "Write chapter (JSON)",
  description: "Replace a chapter's content with TipTap JSON. The doc is validated against the real editor schema (and image sources must be assets/<file>) before anything is written. The previous version is kept under .cadabra/backups/ (or as a .conflict- copy when baseHash shows an outside change).",
  input: { path: PATH, chapterId: CHAPTER_ID, doc: z.record(z.string(), z.unknown()).describe('TipTap document: {"type":"doc","content":[...]}.'), baseHash: BASE_HASH, language: LANGUAGE },
  annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
  run: ({ path, chapterId, doc, baseHash, language }, ctx) =>
    withLock(projectRoot(ctx, path), () => {
      const { root, manifest, hash } = loadProject(ctx, path);
      const lang = editionOf(manifest, language).language;
      const { entry } = findEntry(manifest, chapterId);
      const target = writeTarget(manifest, entry, lang);
      const problem = schemaProblem(doc);
      if (problem) throw new ToolError("invalid_chapter_doc", `the document is not valid in the editor schema: ${problem}`);
      const bad = badImageSources(doc);
      if (bad.length) throw new ToolError("invalid_chapter_doc", `image sources must be project-relative assets/<file> paths: ${bad.join(", ")}`, { sources: bad });
      const w = replaceChapter(root, target.file, doc, baseHash);
      const next = target.commit(manifest);
      if (next) saveManifest(root, next, hash);
      const words = countWords(doc);
      return { summary: `Wrote ${entry.id} "${brief(entry, manifest.editions, lang).title}"${isSource(manifest, lang) ? "" : ` (${lang})`}: ${words} words${w.conflictCopy ? `; the outside version was kept as ${w.conflictCopy}` : ""}`, data: { chapter: { ...brief(entry, manifest.editions, lang), file: target.file }, ...w, words } };
    }),
});

/** Image reference that the Markdown importer could not copy: only `assets/<name>` files already in the project are kept. */
function projectAssetOk(root: string, ref: string): boolean {
  const ext = imageExt(ref);
  if (!ext || !isAssetPath(ref)) return false;
  try {
    return looksLike(ext, readAsset(root, ref));
  } catch {
    // Unreadable or missing asset counts as "not a usable image".
    return false;
  }
}

export const chapterWriteMarkdown = defineTool({
  name: "cadabra_chapter_write_markdown",
  title: "Write chapter (Markdown)",
  description: "Replace a chapter's content with Markdown, converted by the same importer as File > Import (see cadabra://docs/import for mappings). Several top-level headings are merged into this one chapter. Images are kept only when they reference an existing assets/<file> of the project; others become alt text with a warning. Returns the importer's warnings.",
  input: { path: PATH, chapterId: CHAPTER_ID, markdown: z.string().describe("Markdown text for the whole chapter, including its heading."), baseHash: BASE_HASH, language: LANGUAGE },
  annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
  run: ({ path, chapterId, markdown, baseHash, language }, ctx) =>
    withLock(projectRoot(ctx, path), () => {
      const { root, manifest, hash } = loadProject(ctx, path);
      const lang = editionOf(manifest, language).language;
      const { entry } = findEntry(manifest, chapterId);
      const target = writeTarget(manifest, entry, lang);
      const result = importMarkdown(markdown);
      if (result.chapters.length === 0) throw new ToolError("empty_input", "the Markdown has no importable text", { warnings: result.warnings });
      const warnings: ImportWarning[] = [...result.warnings];
      if (result.chapters.length > 1) {
        warnings.push({ code: "multiple-chapters-merged", severity: "info", message: `The Markdown has ${result.chapters.length} top-level sections; they were merged into this one chapter`, count: result.chapters.length });
      }
      const map = new Map<string, string | null>();
      for (const a of result.assets) {
        const keep = projectAssetOk(root, a.sourcePath);
        map.set(a.targetPath, keep ? a.sourcePath : null);
        if (!keep) warnings.push({ code: "image-not-imported", severity: "warning", message: `Image ${a.sourcePath} is not an existing project asset (assets/<file>); kept as alt text`, examples: [a.sourcePath] });
      }
      const merged: ChapterDoc = remapImages({ type: "doc", content: result.chapters.flatMap((c) => c.doc.content) }, map);
      const problem = schemaProblem(merged);
      if (problem) throw new ToolError("invalid_chapter_doc", `the converted document is not valid in the editor schema: ${problem}`);
      const w = replaceChapter(root, target.file, merged, baseHash);
      const next = target.commit(manifest);
      if (next) saveManifest(root, next, hash);
      const words = countWords(merged);
      return { summary: `Wrote ${entry.id} "${brief(entry, manifest.editions, lang).title}"${isSource(manifest, lang) ? "" : ` (${lang})`} from Markdown: ${words} words, ${warnings.length} warning(s)`, data: { chapter: { ...brief(entry, manifest.editions, lang), file: target.file }, ...w, words, warnings } };
    }),
});

export const chapterTools: ToolDef[] = [chapterAdd, chapterRename, chapterMove, chapterRemove, chapterRead, chapterWriteMarkdown, chapterWriteJson];
