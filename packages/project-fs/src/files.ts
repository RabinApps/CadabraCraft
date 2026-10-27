import { createHash, randomBytes } from "node:crypto";
import { closeSync, existsSync, fchmodSync, fstatSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, readSync, renameSync, rmSync, statSync, writeSync } from "node:fs";
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

/**
 * Writes to a uniquely named `.<random>.tmp` in the same directory (never one that exists: `wx`), fsyncs, then renames,
 * so a crash or sync never leaves a half-written file and concurrent writers never share a temp file. The existing
 * file's mode is kept (0644 for a new one). The temp file is removed on any failure. A folder where the file should go,
 * or a file where a folder should be, is `not_a_file`, like the Rust layer.
 */
export function atomicWrite(path: string, bytes: Uint8Array): void {
  const dir = dirname(path);
  const label = basename(path);
  try {
    if (lstatSync(path, { throwIfNoEntry: false })?.isDirectory()) throw new ProjectFsError("not_a_file", `${label} is not a file`);
    try {
      mkdirSync(dir, { recursive: true });
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code;
      if (code === "EEXIST" || code === "ENOTDIR") throw new ProjectFsError("not_a_file", `${basename(dir)} is not a folder`);
      throw e;
    }
  } catch (e) {
    throw fsError(e, label);
  }
  let mode = 0o644;
  try {
    mode = statSync(path).mode & 0o7777;
  } catch {
    /* a new file */
  }
  let tmp = "";
  let fd = -1;
  try {
    for (let attempt = 0; fd < 0; attempt++) {
      tmp = join(dir, `.${randomBytes(6).toString("hex")}.tmp`);
      try {
        fd = openSync(tmp, "wx", 0o600);
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== "EEXIST" || attempt > 8) throw e;
      }
    }
    try {
      writeSync(fd, bytes);
      fsyncSync(fd);
      fchmodSync(fd, mode);
    } finally {
      closeSync(fd);
    }
    renameSync(tmp, path);
  } catch (e) {
    if (tmp) rmSync(tmp, { force: true });
    throw fsError(e, label);
  }
}

/** True when `path` is an iCloud placeholder that has not been downloaded: the real name is missing, `.<name>.icloud` is not. */
export const icloudPending = (path: string): boolean => existsSync(join(dirname(path), `.${basename(path)}.icloud`));

/** Mirrors Rust `open_error`: a missing path is `icloud_placeholder` or `not_found`; anything else maps like `fsError`. */
export function openError(e: unknown, path: string, label: string): ProjectFsError {
  const code = (e as NodeJS.ErrnoException | undefined)?.code;
  if (code === "ENOENT" || code === "ENOTDIR") {
    return icloudPending(path)
      ? new ProjectFsError("icloud_placeholder", `${label} is still downloading from iCloud; try again in a moment`)
      : new ProjectFsError("not_found", `${label} does not exist`);
  }
  return fsError(e, label);
}

/**
 * Reads a regular file of at most `cap` bytes (mirrors Rust `read_regular`). A folder, fifo or device is `not_a_file`
 * without being opened (a fifo would block forever); the size is checked on the opened handle too, and the read is
 * capped at `cap + 1`, so a file that grows while it is read never uses unbounded memory. Links are followed.
 */
export function readRegular(path: string, cap: number, label: string, tooLarge: () => ProjectFsError): Uint8Array {
  const notFile = () => new ProjectFsError("not_a_file", `${label} is not a file`);
  let st;
  try {
    st = statSync(path);
  } catch (e) {
    throw openError(e, path, label);
  }
  if (!st.isFile()) throw notFile();
  if (st.size > cap) throw tooLarge();
  let fd: number;
  try {
    fd = openSync(path, "r");
  } catch (e) {
    throw openError(e, path, label);
  }
  try {
    const hst = fstatSync(fd);
    if (!hst.isFile()) throw notFile();
    if (hst.size > cap) throw tooLarge();
    let buf = Buffer.allocUnsafe(Math.min(cap + 1, hst.size + 1)); // one spare byte to notice growth
    let len = 0;
    for (;;) {
      if (len === buf.length) {
        if (buf.length > cap) throw tooLarge(); // read `cap + 1` bytes: the file is over the cap
        const bigger = Buffer.allocUnsafe(Math.min(cap + 1, buf.length * 2));
        buf.copy(bigger, 0, 0, len);
        buf = bigger;
      }
      const n = readSync(fd, buf, len, buf.length - len, null);
      if (n === 0) return new Uint8Array(buf.subarray(0, len));
      len += n;
    }
  } catch (e) {
    throw fsError(e, label);
  } finally {
    closeSync(fd);
  }
}

/** `name.ext` + 2 -> `name-2.ext` (suffix goes before the last extension of the last segment). */
function withSuffix(rel: string, n: number): string {
  if (n <= 1) return rel;
  const slash = rel.lastIndexOf("/") + 1;
  const dot = rel.lastIndexOf(".");
  return dot > slash ? `${rel.slice(0, dot)}-${n}${rel.slice(dot)}` : `${rel}-${n}`;
}

/** First relative path of the form `candidate(n)` (n = 1, 2, ...) that does not exist under `root` yet. */
function firstFree(root: string, candidate: (n: number) => string): string {
  let n = 1;
  while (existsSync(resolveSafe(root, candidate(n)))) n++;
  return candidate(n);
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
  if (!rel.startsWith("exports/") || rel.endsWith("/")) throw new ProjectFsError("unsafe_path", `unsafe project path: ${rel}`);
  atomicWrite(path, bytes);
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
  const rel = firstFree(root, (n) => withSuffix(base, n));
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
  const toRel = firstFree(root, (n) => withSuffix(base, n));
  atomicWrite(resolveSafe(root, toRel), bytes);
  return toRel;
}

/** "Deletes" a file by moving it to `.cadabra/trash/<stamp>-<path with / as __>`. Nothing is ever removed for good. */
export function trashFile(root: string, rel: string, at: Date = new Date()): string {
  const normalized = normalizeRelative(rel);
  const from = resolveSafe(root, normalized);
  if (!existsSync(from)) throw new ProjectFsError("not_found", `${rel} does not exist`);
  const base = `.cadabra/trash/${stamp(at)}-${normalized.replaceAll("/", "__")}`;
  const toRel = firstFree(root, (n) => withSuffix(base, n));
  const to = resolveSafe(root, toRel);
  try {
    mkdirSync(dirname(to), { recursive: true });
    renameSync(from, to);
  } catch (e) {
    throw fsError(e);
  }
  return toRel;
}
