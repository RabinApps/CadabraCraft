// Project-level helpers shared by the tools: resolving a project, manifest load/save, chapter lookup.
import { lstatSync } from "node:fs";
import { join } from "node:path";
import {
  parseManifest,
  readingOrder,
  serializeManifest,
  type EditionEntry,
  type Manifest,
} from "@cadabracraft/format";
import {
  MANIFEST,
  backupManifest,
  readProjectFile,
  resolveInWorkspace,
  writeProjectFile,
  type WriteResult,
} from "@cadabracraft/project-fs";
import { ToolError } from "./errors";
import type { Ctx } from "./tooling";
import { errMsg } from "@cadabracraft/shared";

export type Section = "frontMatter" | "chapters" | "backMatter";

/** Resolves a workspace path to a real project folder: confined to the root, and it must hold a manifest. */
export function projectRoot(ctx: Ctx, path: string): string {
  const root = resolveInWorkspace(ctx.ws, path);
  try {
    if (lstatSync(join(root, MANIFEST)).isFile()) return root;
  } catch {
    /* fall through */
  }
  throw new ToolError("not_a_project", `no CadabraCraft project (cadabra.json) at ${path}`);
}

export interface Loaded {
  root: string;
  manifest: Manifest;
  /** Hash of cadabra.json as read (or as rewritten after a migration); pass to saveManifest. */
  hash: string;
}

/** Reads and validates the manifest. A manifest from an older format version is backed up, migrated and saved. */
export function loadProject(ctx: Ctx, path: string): Loaded {
  const root = projectRoot(ctx, path);
  const read = readProjectFile(root, MANIFEST);
  if (!read)
    throw new ToolError("not_a_project", `no CadabraCraft project (cadabra.json) at ${path}`);
  const parsed = parseManifest(read.contents);
  if (!parsed.migrated) return { root, manifest: parsed.manifest, hash: read.hash };
  backupManifest(root);
  const w = writeProjectFile(root, MANIFEST, serializeManifest(parsed.manifest), read.hash);
  return { root, manifest: parsed.manifest, hash: w.hash };
}

/** Writes the manifest; if cadabra.json changed since it was loaded, the other version is kept as a conflict copy. */
export function saveManifest(root: string, manifest: Manifest, baseHash: string): WriteResult {
  return writeProjectFile(root, MANIFEST, serializeManifest(manifest), baseHash);
}

export interface Found {
  entry: EditionEntry;
  section: Section;
}

export function findEntry(m: Manifest, id: string): Found {
  for (const section of ["frontMatter", "chapters", "backMatter"] as const) {
    const entry = m[section].find((e) => e.id === id);
    if (entry) return { entry, section };
  }
  throw new ToolError("chapter_not_found", `no chapter with id "${id}"`);
}

/** Reads and parses one chapter file (a source-language path). `chapter_missing` when the file is not there, `chapter_json_invalid` when it is not JSON. */
export function readChapterFile(
  root: string,
  file: string,
): { doc: unknown; hash: string; raw: string } {
  const r = readProjectFile(root, file);
  if (!r) throw new ToolError("chapter_missing", `chapter file ${file} is missing`);
  try {
    return { doc: JSON.parse(r.contents), hash: r.hash, raw: r.contents };
  } catch (e) {
    throw new ToolError("chapter_json_invalid", `${file} is not valid JSON: ${errMsg(e)}`);
  }
}

export const sectionOf = (m: Manifest): { section: Section; entry: EditionEntry }[] =>
  readingOrder(m).map((entry) => ({
    entry,
    section: (m.frontMatter.includes(entry)
      ? "frontMatter"
      : m.backMatter.includes(entry)
        ? "backMatter"
        : "chapters") as Section,
  }));
