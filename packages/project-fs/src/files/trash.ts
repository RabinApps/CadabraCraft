import { existsSync, mkdirSync, readFileSync, renameSync } from "node:fs";
import { dirname } from "node:path";
import { ProjectFsError, fsError, isNotFound } from "../errors";
import { normalizeRelative, resolveSafe } from "../paths";
import { atomicWrite } from "./atomic";
import { firstFree, stamp, withCopySuffix } from "./naming";
import { MANIFEST } from "./project";

/** Copies the manifest into `.cadabra/backups/` before a migration rewrites it. Returns the backup's relative path. */
export function backupManifest(root: string, at: Date = new Date()): string {
  let bytes: Buffer;
  try {
    bytes = readFileSync(resolveSafe(root, MANIFEST));
  } catch (e) {
    throw fsError(e);
  }
  const base = `.cadabra/backups/cadabra-${stamp(at)}.json`;
  const rel = firstFree(root, (n) => withCopySuffix(base, n));
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
  const toRel = firstFree(root, (n) => withCopySuffix(base, n));
  atomicWrite(resolveSafe(root, toRel), bytes);
  return toRel;
}

/** "Deletes" a file by moving it to `.cadabra/trash/<stamp>-<path with / as __>`. Nothing is ever removed for good. */
export function trashFile(root: string, rel: string, at: Date = new Date()): string {
  const normalized = normalizeRelative(rel);
  const from = resolveSafe(root, normalized);
  if (!existsSync(from)) throw new ProjectFsError("not_found", `${rel} does not exist`);
  const base = `.cadabra/trash/${stamp(at)}-${normalized.replaceAll("/", "__")}`;
  const toRel = firstFree(root, (n) => withCopySuffix(base, n));
  const to = resolveSafe(root, toRel);
  try {
    mkdirSync(dirname(to), { recursive: true });
    renameSync(from, to);
  } catch (e) {
    throw fsError(e);
  }
  return toRel;
}
