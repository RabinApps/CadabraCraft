import { z } from "zod";
import { addChapter, moveChapter, removeChapter, renameChapter, type ManuscriptEntry } from "@cadabracraft/format";
import { importMarkdown, type ImportWarning } from "@cadabracraft/import-docx";
import { ProjectFsError, backupFile, countWords, imageExt, looksLike, readAsset, readProjectFile, trashFile, writeProjectFile } from "@cadabracraft/project-fs";
import { isAssetPath, type ChapterDoc } from "@cadabracraft/shared";
import { badImageSources, docToText, emptyChapterDoc, remapImages, schemaProblem } from "../doc";
import { ToolError } from "../errors";
import { findEntry, loadProject, projectRoot, readChapterFile, saveManifest } from "../project";
import { type ToolDef, defineTool, withLock } from "../tooling";
import { PATH } from "./project";

const CHAPTER_ID = z.string().min(1).describe("Chapter id from cadabra_project_info (e.g. ch-1).");
const BASE_HASH = z.string().regex(/^[0-9a-f]{64}$/).optional().describe("hash from cadabra_chapter_read. If the file changed on disk since then, that version is kept as a .conflict- copy before yours is written.");

const brief = (e: ManuscriptEntry) => ({ id: e.id, title: e.title, file: e.file });
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
      if (readProjectFile(root, entry.file)) throw new ToolError("io_error", `${entry.file} already exists on disk but is not listed in the book; refusing to overwrite it`);
      writeProjectFile(root, entry.file, json(emptyChapterDoc(title)));
      const w = saveManifest(root, next, hash);
      return { summary: `Added chapter ${entry.id} "${title}" (${entry.file})`, data: { chapter: entry, position: next.chapters.length, manifestHash: w.hash, conflictCopy: w.conflictCopy } };
    }),
});

export const chapterRename = defineTool({
  name: "cadabra_chapter_rename",
  title: "Rename chapter",
  description: "Change a chapter's title in the manifest. The file keeps its name and its content (including its heading) is not changed.",
  input: { path: PATH, chapterId: CHAPTER_ID, title: z.string().min(1).describe("New title.") },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
  run: ({ path, chapterId, title }, ctx) =>
    withLock(projectRoot(ctx, path), () => {
      const { root, manifest, hash } = loadProject(ctx, path);
      const next = chaptersOnly(() => renameChapter(manifest, chapterId, title), chapterId);
      saveManifest(root, next, hash);
      const chapter = next.chapters.find((c) => c.id === chapterId)!;
      return { summary: `Renamed ${chapterId} to "${title}"`, data: { chapter: brief(chapter) } };
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
      return { summary: `Moved ${chapterId} to position ${position}`, data: { position, order: next.chapters.map((c) => ({ id: c.id, title: c.title })) } };
    }),
});

export const chapterRemove = defineTool({
  name: "cadabra_chapter_remove",
  title: "Remove chapter",
  description: "Remove a chapter from the book. The manifest is saved first, then the chapter file is moved to .cadabra/trash/ (never deleted), so the text can be recovered.",
  input: { path: PATH, chapterId: CHAPTER_ID },
  annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
  run: ({ path, chapterId }, ctx) =>
    withLock(projectRoot(ctx, path), () => {
      const { root, manifest, hash } = loadProject(ctx, path);
      const { manifest: next, removed } = chaptersOnly(() => removeChapter(manifest, chapterId), chapterId);
      saveManifest(root, next, hash);
      let trashedTo: string | null = null;
      try {
        trashedTo = trashFile(root, removed.file);
      } catch (e) {
        if (!(e instanceof ProjectFsError && e.code === "not_found")) throw e;
      }
      return { summary: `Removed ${chapterId} "${removed.title}"${trashedTo ? `; file moved to ${trashedTo}` : " (its file was already missing)"}`, data: { removed: brief(removed), trashedTo } };
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
  input: { path: PATH, chapterId: CHAPTER_ID },
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
  run: ({ path, chapterId }, ctx) => {
    const { root, manifest } = loadProject(ctx, path);
    const { entry, section } = findEntry(manifest, chapterId);
    const { doc, hash } = readChapterFile(root, entry);
    const words = countWords(doc);
    return { summary: `${entry.title}: ${words} words`, data: { chapter: { ...brief(entry), section }, doc, text: docToText(doc), words, hash } };
  },
});

interface Written {
  hash: string;
  conflictCopy: string | null;
  backup: string | null;
}

/** Replaces a chapter file. The previous version is kept: as a conflict copy when baseHash shows it changed outside, else as a backup. */
function replaceChapter(root: string, entry: ManuscriptEntry, doc: unknown, baseHash: string | undefined): Written {
  const text = json(doc);
  const existing = readProjectFile(root, entry.file);
  const conflicts = !!(baseHash && existing && existing.hash !== baseHash);
  const backup = existing && !conflicts && existing.contents !== text ? backupFile(root, entry.file) : null;
  const w = writeProjectFile(root, entry.file, text, baseHash);
  return { hash: w.hash, conflictCopy: w.conflictCopy, backup };
}

export const chapterWriteJson = defineTool({
  name: "cadabra_chapter_write_json",
  title: "Write chapter (JSON)",
  description: "Replace a chapter's content with TipTap JSON. The doc is validated against the real editor schema (and image sources must be assets/<file>) before anything is written. The previous version is kept under .cadabra/backups/ (or as a .conflict- copy when baseHash shows an outside change).",
  input: { path: PATH, chapterId: CHAPTER_ID, doc: z.record(z.string(), z.unknown()).describe('TipTap document: {"type":"doc","content":[...]}.'), baseHash: BASE_HASH },
  annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
  run: ({ path, chapterId, doc, baseHash }, ctx) =>
    withLock(projectRoot(ctx, path), () => {
      const { root, manifest } = loadProject(ctx, path);
      const { entry } = findEntry(manifest, chapterId);
      const problem = schemaProblem(doc);
      if (problem) throw new ToolError("invalid_chapter_doc", `the document is not valid in the editor schema: ${problem}`);
      const bad = badImageSources(doc);
      if (bad.length) throw new ToolError("invalid_chapter_doc", `image sources must be project-relative assets/<file> paths: ${bad.join(", ")}`, { sources: bad });
      const w = replaceChapter(root, entry, doc, baseHash);
      const words = countWords(doc);
      return { summary: `Wrote ${entry.id} "${entry.title}": ${words} words${w.conflictCopy ? `; the outside version was kept as ${w.conflictCopy}` : ""}`, data: { chapter: brief(entry), ...w, words } };
    }),
});

/** Image reference that the Markdown importer could not copy: only `assets/<name>` files already in the project are kept. */
function projectAssetOk(root: string, ref: string): boolean {
  const ext = imageExt(ref);
  if (!ext || !isAssetPath(ref)) return false;
  try {
    return looksLike(ext, readAsset(root, ref));
  } catch {
    return false;
  }
}

export const chapterWriteMarkdown = defineTool({
  name: "cadabra_chapter_write_markdown",
  title: "Write chapter (Markdown)",
  description: "Replace a chapter's content with Markdown, converted by the same importer as File > Import (see cadabra://docs/import for mappings). Several top-level headings are merged into this one chapter. Images are kept only when they reference an existing assets/<file> of the project; others become alt text with a warning. Returns the importer's warnings.",
  input: { path: PATH, chapterId: CHAPTER_ID, markdown: z.string().describe("Markdown text for the whole chapter, including its heading."), baseHash: BASE_HASH },
  annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
  run: ({ path, chapterId, markdown, baseHash }, ctx) =>
    withLock(projectRoot(ctx, path), () => {
      const { root, manifest } = loadProject(ctx, path);
      const { entry } = findEntry(manifest, chapterId);
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
      const w = replaceChapter(root, entry, merged, baseHash);
      const words = countWords(merged);
      return { summary: `Wrote ${entry.id} "${entry.title}" from Markdown: ${words} words, ${warnings.length} warning(s)`, data: { chapter: brief(entry), ...w, words, warnings } };
    }),
});

export const chapterTools: ToolDef[] = [chapterAdd, chapterRename, chapterMove, chapterRemove, chapterRead, chapterWriteMarkdown, chapterWriteJson];
