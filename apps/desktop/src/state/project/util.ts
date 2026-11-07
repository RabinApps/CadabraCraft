import { baseName } from "../../lib/paths";
import { t } from "@lingui/core/macro";
import { retargetFile } from "@cadabracraft/format";
import { isChapterDoc } from "@cadabracraft/editor-schema";
import type { ChapterDoc } from "@cadabracraft/shared";
import type { HistoryEntry, History } from "./types";

export const emptyDoc = (title: string): ChapterDoc => ({
  type: "doc",
  content: [
    { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: title }] },
    { type: "paragraph" },
  ],
});

/** The first heading's text, else the first text found, else the file name without its number prefix and extension. */
export function titleOfDoc(doc: unknown, file: string): string {
  const texts = (n: unknown): string => {
    const { text, content } = (n ?? {}) as { text?: unknown; content?: unknown };
    return typeof text === "string"
      ? text
      : Array.isArray(content)
        ? content.map(texts).join("")
        : "";
  };
  const raw = (doc as { content?: unknown } | null)?.content;
  const nodes: unknown[] = Array.isArray(raw) ? raw : [];
  const found = [nodes.find((n) => (n as { type?: unknown } | null)?.type === "heading"), ...nodes]
    .map((n) => texts(n).trim())
    .find((x) => x);
  return (
    found?.slice(0, 80) ||
    baseName(file)
      .replace(/\.json$/, "")
      .replace(/^\d+-/, "")
  );
}

/** A notice that reports a failure or lost data: the header announces it assertively. */
export const alertOf = (text: string): { notice: string; alertNotice: string } => ({
  notice: text,
  alertNotice: text,
});

/** True while the shown notice is a failure, which the header announces assertively. */
export const noticeIsAlert = (s: { notice: string; alertNotice: string }): boolean =>
  s.notice !== "" && s.notice === s.alertNotice;

export const NO_HISTORY: History = { undo: [], redo: [] };
export const HISTORY_LIMIT = 100;

/** Rewrites every mention of page file `from` as `to` (a restored page that had to take another name). */
export function retargetEntry(
  e: HistoryEntry,
  language: string,
  from: string,
  to: string,
): HistoryEntry {
  return {
    ...e,
    before: retargetFile(e.before, language, from, to),
    after: retargetFile(e.after, language, from, to),
    ...(e.file?.path === from ? { file: { ...e.file, path: to } } : {}),
    ...(e.imported?.some((i) => i.path === from)
      ? { imported: e.imported.map((i) => (i.path === from ? { ...i, path: to } : i)) }
      : {}),
    ...(e.others?.some((o) => o.language === language && o.path === from)
      ? {
          others: e.others.map((o) =>
            o.language === language && o.path === from ? { ...o, path: to } : o,
          ),
        }
      : {}),
  };
}

/** How long typing may sit unsaved before it is written to disk. */
export const AUTOSAVE_MS = 2000;
/** Longest typing may sit unsaved while the author keeps typing (each keystroke restarts the AUTOSAVE_MS delay). */
export const AUTOSAVE_MAX_MS = 10000;

/** Parses a chapter file's text and checks it against the editor schema. Throws (a message for the author) for corrupt files; the file is never touched. */
export function parseChapter(contents: string, file: string): ChapterDoc {
  let raw: unknown;
  try {
    raw = JSON.parse(contents);
  } catch {
    throw new Error(
      t`${file} is not valid JSON, so it was not opened. The file was left untouched.`,
    );
  }
  if (!isChapterDoc(raw))
    throw new Error(
      t`${file} is not a valid chapter, so it was not opened. The file was left untouched.`,
    );
  return raw;
}

/** Runs housekeeping that must never stop a book from opening: any failure (rejected or thrown) gives `fallback`. */
export async function bestEffort<T>(run: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await run();
  } catch {
    return fallback;
  }
}

/** A group of page writes failed; `stuck` are the pages that were written and could not be put back. */
export class PartialWrite extends Error {
  constructor(
    message: string,
    readonly stuck: { file: string; from: string; to: string }[],
  ) {
    super(message);
  }
}
