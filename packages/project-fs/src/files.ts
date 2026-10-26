import { createHash } from "node:crypto";
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, writeSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { ProjectFsError, fsError, isNotFound } from "./errors";
import { normalizeRelative, resolveSafe } from "./paths";

export const MANIFEST = "cadabra.json";
/** Folders created in a new project (docs/file-format.md). */
export const PROJECT_DIRS = ["manuscript", "front-matter", "back-matter", "assets", "exports", ".cadabra"] as const;

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

export const hashBytes = (b: Uint8Array): string => createHash("sha256").update(b).digest("hex");

/** UTC `YYYYMMDD-HHMM`, used in conflict, backup and trash names. */
export function stamp(at: Date = new Date()): string {
  const p = (n: number, w = 2) => String(n).padStart(w, "0");
  return `${p(at.getUTCFullYear(), 4)}${p(at.getUTCMonth() + 1)}${p(at.getUTCDate())}-${p(at.getUTCHours())}${p(at.getUTCMinutes())}`;
}

/** Writes to `.<name>.tmp` in the same directory, fsyncs, then renames, so a crash or sync never leaves a half-written file. */
export function atomicWrite(path: string, bytes: Uint8Array): void {
  const dir = dirname(path);
  const tmp = join(dir, `.${basename(path)}.tmp`);
  try {
    mkdirSync(dir, { recursive: true });
    const fd = openSync(tmp, "w");
    try {
      writeSync(fd, bytes);
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    renameSync(tmp, path);
  } catch (e) {
    rmSync(tmp, { force: true });
    throw fsError(e);
  }
}

/** `name.ext` + 2 -> `name-2.ext` (suffix goes before the last extension of the last segment). */
function withSuffix(rel: string, n: number): string {
  if (n <= 1) return rel;
  const slash = rel.lastIndexOf("/") + 1;
  const dot = rel.lastIndexOf(".");
  return dot > slash ? `${rel.slice(0, dot)}-${n}${rel.slice(dot)}` : `${rel}-${n}`;
}

/**
 * `<stem>.conflict-<stamp>.<ext>` next to `rel` (`n` > 1 adds `-n` after the stamp). The extension is that of the last
 * path segment only; the Rust layer splits the whole path at its last dot (see fixtures/contract/conflict-name.json).
 */
export function conflictPath(rel: string, stampText: string, n = 1): string {
  const slash = rel.lastIndexOf("/") + 1;
  const dir = rel.slice(0, slash);
  const name = rel.slice(slash);
  const dot = name.lastIndexOf(".");
  const [stem, ext] = dot >= 0 ? [name.slice(0, dot), name.slice(dot + 1)] : [name, ""];
  const mark = `.conflict-${stampText}${n > 1 ? `-${n}` : ""}`;
  return `${dir}${stem}${mark}${dot >= 0 && ext !== "" ? `.${ext}` : ""}`;
}

/** Creates the folder layout and writes the manifest. Refuses to touch an existing project. */
export function createProject(root: string, manifestJson: string): void {
  if (existsSync(join(root, MANIFEST))) throw new ProjectFsError("already_exists", "a project already exists in this folder");
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
      throw new ProjectFsError("icloud_placeholder", `${rel} is still downloading from iCloud; try again in a moment`);
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
export function writeProjectFile(root: string, rel: string, contents: string, baseHash?: string | null, at: Date = new Date()): WriteResult {
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
      let n = 1;
      while (existsSync(resolveSafe(root, conflictPath(normalized, s, n)))) n++;
      conflictCopy = conflictPath(normalized, s, n);
      atomicWrite(resolveSafe(root, conflictCopy), existing);
    }
  }
  const bytes = utf8.encode(contents);
  atomicWrite(path, bytes);
  return { hash: hashBytes(bytes), conflictCopy };
}

/** Writes binary output (EPUB/PDF) under the project, atomically. */
export function writeBytes(root: string, rel: string, bytes: Uint8Array): void {
  atomicWrite(resolveSafe(root, rel), bytes);
}

/** Copies the manifest into `.cadabra/backups/` before a migration rewrites it. Returns the backup's relative path. */
export function backupManifest(root: string, at: Date = new Date()): string {
  let bytes: Buffer;
  try {
    bytes = readFileSync(resolveSafe(root, MANIFEST));
  } catch (e) {
    throw fsError(e);
  }
  const base = `.cadabra/backups/cadabra-${stamp(at)}.json`;
  let n = 1;
  while (existsSync(resolveSafe(root, withSuffix(base, n)))) n++;
  const rel = withSuffix(base, n);
  atomicWrite(resolveSafe(root, rel), bytes);
  return rel;
}

/**
 * Copies the current version of `rel` to `.cadabra/backups/<stamp>-<path with / as __>` before it is replaced.
 * Returns the backup's relative path, or null when there is nothing to back up. Never overwrites an earlier backup.
 */
export function backupFile(root: string, rel: string, at: Date = new Date()): string | null {
  const normalized = normalizeRelative(rel);
  let bytes: Buffer;
  try {
    bytes = readFileSync(resolveSafe(root, normalized));
  } catch (e) {
    if (isNotFound(e)) return null;
    throw fsError(e);
  }
  const base = `.cadabra/backups/${stamp(at)}-${normalized.replaceAll("/", "__")}`;
  let n = 1;
  while (existsSync(resolveSafe(root, withSuffix(base, n)))) n++;
  const toRel = withSuffix(base, n);
  atomicWrite(resolveSafe(root, toRel), bytes);
  return toRel;
}

/** "Deletes" a file by moving it to `.cadabra/trash/<stamp>-<path with / as __>`. Nothing is ever removed for good. */
export function trashFile(root: string, rel: string, at: Date = new Date()): string {
  const normalized = normalizeRelative(rel);
  const from = resolveSafe(root, normalized);
  if (!existsSync(from)) throw new ProjectFsError("not_found", `${rel} does not exist`);
  const base = `.cadabra/trash/${stamp(at)}-${normalized.replaceAll("/", "__")}`;
  let n = 1;
  while (existsSync(resolveSafe(root, withSuffix(base, n)))) n++;
  const toRel = withSuffix(base, n);
  const to = resolveSafe(root, toRel);
  try {
    mkdirSync(dirname(to), { recursive: true });
    renameSync(from, to);
  } catch (e) {
    throw fsError(e);
  }
  return toRel;
}
