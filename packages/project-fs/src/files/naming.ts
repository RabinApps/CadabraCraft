import { existsSync } from "node:fs";
import { resolveSafe } from "../paths";

/** UTC `YYYYMMDD-HHMM`, used in conflict, backup and trash names. */
export function stamp(at: Date = new Date()): string {
  const p = (n: number, w = 2) => String(n).padStart(w, "0");
  return `${p(at.getUTCFullYear(), 4)}${p(at.getUTCMonth() + 1)}${p(at.getUTCDate())}-${p(at.getUTCHours())}${p(at.getUTCMinutes())}`;
}

/** `name.ext` + 2 -> `name-2.ext` (suffix goes before the last extension of the last segment). */
export function withSuffix(rel: string, n: number): string {
  if (n <= 1) return rel;
  const slash = rel.lastIndexOf("/") + 1;
  const dot = rel.lastIndexOf(".");
  return dot > slash ? `${rel.slice(0, dot)}-${n}${rel.slice(dot)}` : `${rel}-${n}`;
}

/**
 * Backup and trash copies count with `~`: `name.ext` + 2 -> `name~2.ext`. Page names never hold `~`, so the copy of `a.json`
 * cannot be mistaken for a copy of a page called `a-2.json` (the plain `-n` of `withSuffix` could).
 */
export function withCopySuffix(rel: string, n: number): string {
  if (n <= 1) return rel;
  const slash = rel.lastIndexOf("/") + 1;
  const dot = rel.lastIndexOf(".");
  return dot > slash ? `${rel.slice(0, dot)}~${n}${rel.slice(dot)}` : `${rel}~${n}`;
}

/** First relative path of the form `candidate(n)` (n = 1, 2, ...) that does not exist under `root` yet. */
export function firstFree(root: string, candidate: (n: number) => string): string {
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
