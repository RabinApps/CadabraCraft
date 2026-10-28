import { existsSync, readFileSync, mkdirSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { ProjectFsError, fsError, isNotFound } from "../errors";
import { normalizeRelative, resolveSafe } from "../paths";
import { atomicWrite, hashBytes } from "./atomic";
import { conflictPath, firstFree, stamp } from "./naming";

export const MANIFEST = "cadabra.json";
/** Folders created in a new project (docs/file-format.md). */
export const PROJECT_DIRS = [
  "manuscript",
  "front-matter",
  "back-matter",
  "assets",
  "exports",
  ".cadabra",
] as const;

export interface FileRead {
  contents: string;
  /** sha256 hex of the raw bytes, passed back as `baseHash` to detect external edits. */
  hash: string;
}

export interface WriteResult {
  hash: string;
  /** Relative path of the kept copy of the externally changed version, or null. */
  conflictCopy: string | null;
}

const utf8 = new TextEncoder();

/** Creates the folder layout and writes the manifest. Refuses to touch an existing project. */
export function createProject(root: string, manifestJson: string): void {
  if (existsSync(join(root, MANIFEST)))
    throw new ProjectFsError("already_exists", "a project already exists in this folder");
  try {
    for (const d of PROJECT_DIRS) mkdirSync(join(root, d), { recursive: true });
  } catch (e) {
    throw fsError(e);
  }
  atomicWrite(resolveSafe(root, MANIFEST), utf8.encode(manifestJson));
}

/** Reads a project file as UTF-8. Null if missing. A cloud placeholder that is not downloaded yet is an error. */
export function readProjectFile(root: string, rel: string): FileRead | null {
  const path = resolveSafe(root, rel);
  let bytes: Buffer;
  try {
    bytes = readFileSync(path);
  } catch (e) {
    if (!isNotFound(e)) throw fsError(e);
    if (existsSync(join(dirname(path), `.${basename(path)}.icloud`))) {
      throw new ProjectFsError(
        "icloud_placeholder",
        `${rel} is still downloading from iCloud; try again in a moment`,
      );
    }
    return null;
  }
  let contents: string;
  try {
    contents = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    throw new ProjectFsError("invalid_utf8", `${rel} is not valid UTF-8`);
  }
  return { contents, hash: hashBytes(bytes) };
}

/**
 * Writes a project file. When `baseHash` is given and the file on disk no longer matches it (changed outside, e.g. by
 * sync), the on-disk version is kept first as a conflict copy. An existing conflict copy is never overwritten.
 */
export function writeProjectFile(
  root: string,
  rel: string,
  contents: string,
  baseHash?: string | null,
  at: Date = new Date(),
): WriteResult {
  const path = resolveSafe(root, rel);
  const normalized = normalizeRelative(rel);
  let conflictCopy: string | null = null;
  if (baseHash) {
    let existing: Buffer | null = null;
    try {
      existing = readFileSync(path);
    } catch (e) {
      if (!isNotFound(e)) throw fsError(e);
    }
    if (existing && hashBytes(existing) !== baseHash) {
      const s = stamp(at);
      conflictCopy = firstFree(root, (n) => conflictPath(normalized, s, n));
      atomicWrite(resolveSafe(root, conflictCopy), existing);
    }
  }
  const bytes = utf8.encode(contents);
  atomicWrite(path, bytes);
  return { hash: hashBytes(bytes), conflictCopy };
}

/** Writes binary output (EPUB, PDF, Markdown) under `exports/` of the project, atomically. Anything outside `exports/<name>` is `unsafe_path`. */
export function writeBytes(root: string, rel: string, bytes: Uint8Array): void {
  const path = resolveSafe(root, rel);
  if (!rel.startsWith("exports/") || rel.endsWith("/"))
    throw new ProjectFsError("unsafe_path", `unsafe project path: ${rel}`);
  atomicWrite(path, bytes);
}
