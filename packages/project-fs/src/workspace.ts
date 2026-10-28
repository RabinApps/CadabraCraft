import { realpathSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { ProjectFsError } from "./errors";
import { isInside, resolveReal } from "./paths";
import { errMsg } from "@cadabracraft/shared";

/** The folder an MCP server may touch. `root` is a real path (symlinks resolved). */
export interface Workspace {
  root: string;
}

/** Throws `workspace_invalid` unless `root` is an existing directory. */
export function openWorkspace(root: string): Workspace {
  if (!root) throw new ProjectFsError("workspace_invalid", "workspace root is empty");
  try {
    const real = realpathSync(root);
    if (!statSync(real).isDirectory()) throw new Error("not a directory");
    return { root: real };
  } catch (e) {
    throw new ProjectFsError(
      "workspace_invalid",
      `workspace root is not a usable directory: ${root} (${errMsg(e)})`,
    );
  }
}

/**
 * Resolves a caller-supplied path (relative to the root, or absolute but inside it) to a real path. Refused with
 * `path_escape` when it contains NUL, uses `..` to leave the root, or reaches outside through a symlink
 * (also when the target does not exist yet). The returned path is canonical, so later operations act on it directly.
 */
export function resolveInWorkspace(ws: Workspace, input: string): string {
  if (!input || input.includes("\0"))
    throw new ProjectFsError("path_escape", "path is empty or contains a NUL byte");
  const abs = resolve(ws.root, input);
  if (!isInside(ws.root, abs))
    throw new ProjectFsError("path_escape", `path is outside the workspace: ${input}`);
  const real = resolveReal(abs);
  if (!isInside(ws.root, real))
    throw new ProjectFsError(
      "path_escape",
      `path leaves the workspace through a symbolic link: ${input}`,
    );
  return real;
}
