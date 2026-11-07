import { t } from "@lingui/core/macro";
import {
  commentsProblem,
  insertChaptersAt,
  sourceFile,
  sourceTitle,
  type CommentsFile,
  type CommentThread,
} from "@cadabracraft/format";
import type { ChapterDoc } from "@cadabracraft/shared";
import { bridge } from "../../../lib/bridge";
import { commentAnchors } from "../../../lib/comments/comments";
import { errText } from "../../../lib/projectError";
import { cutDoc, splitPoints } from "../../../lib/split/splitPoints";
import { commentsFile } from "../comments";
import { parseChapter } from "../util";
import type { PageActions } from "../types";
import type { Ctx } from "../context";

const toText = (doc: ChapterDoc) => JSON.stringify(doc, null, 2);
const threadsText = (threads: CommentThread[]) => `${JSON.stringify({ threads }, null, 2)}\n`;

/**
 * The comment threads of the chapter split into the ones anchored in the part that moves (`moved`) and the ones that
 * stay, or null when the chapter has no comments file. Throws, having written nothing, when the file cannot be read.
 */
async function splitThreads(
  root: string,
  id: string,
  tail: ChapterDoc,
): Promise<{ text: string; moved: CommentThread[]; kept: CommentThread[] } | null> {
  const anchors = new Set(commentAnchors(tail));
  if (anchors.size === 0) return null;
  const read = await bridge.readFile(root, commentsFile(id));
  if (!read) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(read.contents);
  } catch {
    throw new Error(
      t`the comments of this chapter are not valid JSON, so they could not be divided`,
    );
  }
  if (commentsProblem(parsed))
    throw new Error(
      t`the comments of this chapter could not be read, so they could not be divided`,
    );
  const threads = (parsed as CommentsFile).threads;
  return {
    text: read.contents,
    moved: threads.filter((x) => anchors.has(x.id)),
    kept: threads.filter((x) => !anchors.has(x.id)),
  };
}

/** Splitting a chapter of the open book at a heading. */
export const createSplitActions = (ctx: Ctx): Pick<PageActions, "splitChapter"> => {
  const { set, get, need, saveManifest, record, flush, load, writePage } = ctx;
  return {
    async splitChapter(id, block, title) {
      await flush();
      const { root, manifest } = need();
      if (manifest.editions.length > 1)
        throw new Error(
          t`A book with translations cannot be split yet: the translations would no longer line up with the original. Split the chapter by hand, or remove the translations first.`,
        );
      const at = manifest.chapters.findIndex((e) => e.id === id);
      const entry = manifest.chapters[at];
      if (!entry || entry.kind !== undefined) throw new Error(t`Only a chapter can be split.`);
      const file = sourceFile(entry, manifest.editions);
      const read = await bridge.readFile(root, file);
      if (!read) throw new Error(t`The chapter file is missing.`);
      set({ hashes: { ...get().hashes, [file]: read.hash } });
      const doc = parseChapter(read.contents, file);
      const point = splitPoints(doc).find((p) => p.block === block);
      if (!point) throw new Error(t`That place is not a heading the chapter can be split at.`);
      const { head, tail } = cutDoc(doc, block);
      const name = title.trim() || point.text;

      const { manifest: next, entries } = insertChaptersAt(manifest, [name], at + 1);
      const created = entries[0]!;
      const newFile = sourceFile(created, next.editions);
      const comments = await splitThreads(root, id, tail);
      // New files first, then the book's list, then the shortened chapter: a failure never loses text (the worst case is a
      // chapter that is listed twice), and the steps before the first write are undone below.
      const stored: string[] = [];
      let listed = false;
      const notes: string[] = [];
      try {
        const add = async (path: string, text: string) => {
          const note = await writePage(path, text);
          stored.push(path);
          if (note) notes.push(note);
        };
        await add(newFile, toText(tail));
        if (comments?.moved.length)
          await add(commentsFile(created.id), threadsText(comments.moved));
        await saveManifest(next);
        listed = true;
        const note = await writePage(file, toText(head));
        if (note) notes.push(note);
        if (comments?.moved.length) {
          const kept = threadsText(comments.kept);
          const n = await writePage(commentsFile(id), kept);
          if (n) notes.push(n);
        }
      } catch (e) {
        // Put the book back as it was: the original chapter text is still whole unless its own write was the one that failed.
        if (listed) await saveManifest(manifest).catch(() => {});
        await writePage(file, read.contents).catch(() => {});
        if (comments) await writePage(commentsFile(id), comments.text).catch(() => {});
        await bridge.trashFile(root, newFile).catch(() => {});
        throw new Error(
          t`The chapter was not split: ${errText(e)}. Nothing in the book was changed.`,
          { cause: e },
        );
      }
      // One undo step: the shortened chapter (and its comments), the new chapter's file and the book's list.
      const docs = [
        { file, before: read.contents, after: toText(head) },
        ...(comments?.moved.length
          ? [{ file: commentsFile(id), before: comments.text, after: threadsText(comments.kept) }]
          : []),
      ];
      record(
        {
          label: t`Split ${sourceTitle(entry, manifest.editions)}`,
          docs,
          imported: [{ path: newFile }],
        },
        manifest,
        next,
      );
      await load(created.id);
      set({
        notice: [t`Split off “${name}”. Undo puts the chapter back together.`, ...notes].join(". "),
      });
      return created.id;
    },
  };
};
