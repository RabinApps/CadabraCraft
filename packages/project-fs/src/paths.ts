import { lstatSync, readlinkSync, realpathSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { ProjectFsError } from "./errors";

/**
 * Validates a project-relative path the way Rust `project::resolve` does: non-empty, no backslash, only normal
 * components. Interior `.` and repeated `/` are dropped (as `Path::components` does); a leading `./`, `..` and a leading
 * `/` are refused. NUL is refused too (Rust fails on it later, at the syscall). Returns the normalised `a/b` form.
 */
export function normalizeRelative(rel: string): string {
  const bad = () => new ProjectFsError("unsafe_path", `unsafe project path: ${rel}`);
  if (!rel || rel.includes("\\") || rel.includes("\0")) throw bad();
  const parts = rel.split("/");
  if (parts[0] === "" || parts[0] === ".") throw bad();
  const out: string[] = [];
  for (const p of parts) {
    if (p === "..") throw bad();
    if (p !== "" && p !== ".") out.push(p);
  }
  if (out.length === 0) throw bad();
  return out.join("/");
}

/** Lexical join of a validated relative path onto `root`. */
export const resolveRelative = (root: string, rel: string): string => join(root, normalizeRelative(rel));

/** True when `p` is `root` or lies below it (component-wise, not a string prefix). */
export function isInside(root: string, p: string): boolean {
  const r = relative(root, p);
  return r === "" || (r !== ".." && !r.startsWith(`..${sep}`) && !isAbsolute(r));
}

/**
 * Real path of `p` even when it (or its tail) does not exist yet: the deepest existing ancestor is resolved with
 * realpath and the rest appended. A dangling symlink is followed to where it points, so writing "through" it cannot
 * create a file outside the folder it lives in.
 */
export function resolveReal(p: string, depth = 0): string {
  if (depth > 40) throw new ProjectFsError("path_escape", `too many symbolic links: ${p}`);
  try {
    return realpathSync(p);
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code === "ELOOP") throw new ProjectFsError("path_escape", `symbolic link loop: ${p}`);
    if (code !== "ENOENT" && code !== "ENOTDIR") throw e;
  }
  let st: ReturnType<typeof lstatSync> | null = null;
  try {
    st = lstatSync(p);
  } catch {
    /* does not exist */
  }
  if (st?.isSymbolicLink()) return resolveReal(resolve(dirname(p), readlinkSync(p)), depth + 1);
  const parent = dirname(p);
  if (parent === p) return p;
  return join(resolveReal(parent, depth + 1), basename(p));
}

/**
 * `resolveRelative` plus symlink containment: the result must stay inside the real path of `root`. Stricter than the Rust
 * layer (which is lexical only); the MCP server must never be steered out of a project by a symlinked folder.
 */
export function resolveSafe(root: string, rel: string): string {
  const abs = resolveRelative(root, rel);
  if (!isInside(resolveReal(root), resolveReal(abs))) throw new ProjectFsError("path_escape", `${rel} leaves the project folder through a symbolic link`);
  return abs;
}

/** Last component of an OS path: `\\` is a separator on Windows only (on POSIX it is a legal file-name character). */
const lastComponent = (p: string): string => p.split(process.platform === "win32" ? /[\\/]/ : "/").filter(Boolean).pop() ?? "";

const asciiLower = (s: string): string => s.replace(/[A-Z]/g, (c) => c.toLowerCase());

/** Extension of the last path component, lower-cased (ASCII only), like Rust `Path::extension`: dotfiles have none. */
export function fileExtension(name: string): string | null {
  const base = lastComponent(name);
  const i = base.lastIndexOf(".");
  if (base === ".." || i <= 0) return null;
  return asciiLower(base.slice(i + 1));
}

export const fileBaseName = lastComponent;
