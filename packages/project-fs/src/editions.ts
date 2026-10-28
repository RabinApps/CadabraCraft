import { entryFile, type EditionEntry } from "@cadabracraft/format";
import { resolveSafe } from "./paths";
import { readProjectFile, type FileRead } from "./files/project";

/**
 * Project path of one entry in one language, checked for escapes like every project path. The source edition has its
 * stored path; a translation has the path the manifest records for it. Null when that language has no file yet
 * (a chapter that is not translated).
 */
export function entryPath(root: string, entry: EditionEntry, language: string): string | null {
  const rel = entryFile(entry, language);
  return rel === undefined ? null : resolveSafe(root, rel);
}

/** Reads one entry's file in one language. Null when that language has no file for the entry, or the file is missing. */
export function readEntryFile(
  root: string,
  entry: EditionEntry,
  language: string,
): FileRead | null {
  const rel = entryFile(entry, language);
  return rel === undefined ? null : readProjectFile(root, rel);
}
