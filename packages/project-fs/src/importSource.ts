// Read-only access to files picked for import. Nothing here writes next to the source file.
import { readFileSync, realpathSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { MAX_IMAGE_BYTES, imageExt, looksLike } from "./assets";
import { ProjectFsError, fsError } from "./errors";
import { fileBaseName, fileExtension, isInside } from "./paths";

/** Document types the importer understands. */
export const IMPORT_EXTENSIONS = ["docx", "md", "markdown", "html", "htm", "txt"] as const;
/** Largest source document accepted, in bytes. */
export const MAX_IMPORT_BYTES = 200 * 1024 * 1024;
const MAX_IMPORT_MB = MAX_IMPORT_BYTES / 1024 / 1024;

/** Reads a document the user picked. Only allowlisted extensions, regular files, capped size. */
export function readSource(path: string): Uint8Array {
  const name = fileBaseName(path);
  const ext = fileExtension(path) ?? "";
  if (!name || !(IMPORT_EXTENSIONS as readonly string[]).includes(ext)) {
    throw new ProjectFsError("unsupported_source", `${name || path} is not a .docx, .md, .markdown, .html, .htm or .txt file`);
  }
  try {
    const st = statSync(path);
    if (!st.isFile()) throw new ProjectFsError("not_a_file", `${name} is not a file`);
    if (st.size > MAX_IMPORT_BYTES) throw new ProjectFsError("too_large", `${name} is larger than ${MAX_IMPORT_MB} MB`);
    const bytes = readFileSync(path);
    if (bytes.length > MAX_IMPORT_BYTES) throw new ProjectFsError("too_large", `${name} is larger than ${MAX_IMPORT_MB} MB`);
    return new Uint8Array(bytes);
  } catch (e) {
    throw fsError(e, name);
  }
}

/**
 * Reads an image a Markdown file references, relative to that file's folder. Refuses absolute paths, `..`, backslashes,
 * NUL, symlinks that lead outside the folder, non-image extensions, oversized files and content that is not the claimed type.
 */
export function readRelativeImage(sourceFile: string, reference: string): Uint8Array {
  const shown = Array.from(reference).slice(0, 80).join("");
  const parts = reference.split("/");
  const safe = reference !== "" && !reference.includes("\\") && !reference.includes("\0") && parts[0] !== "" && parts.every((p) => p !== "..");
  if (!safe) throw new ProjectFsError("unsafe_path", `image path is not allowed: ${shown}`);
  const ext = imageExt(reference);
  if (!ext) throw new ProjectFsError("unsupported_image", `unsupported image type: ${shown}`);
  let base: string;
  try {
    base = realpathSync(dirname(sourceFile));
  } catch (e) {
    throw fsError(e);
  }
  let full: string;
  try {
    full = realpathSync(join(base, reference));
  } catch {
    throw new ProjectFsError("not_found", `image not found: ${shown}`);
  }
  if (!isInside(base, full)) throw new ProjectFsError("path_escape", `image is outside the document folder: ${shown}`);
  try {
    const st = statSync(full);
    if (!st.isFile()) throw new ProjectFsError("not_a_file", `${shown} is not a file`);
    if (st.size > MAX_IMAGE_BYTES) throw new ProjectFsError("too_large", `${shown} is larger than ${MAX_IMAGE_BYTES / 1024 / 1024} MB`);
    const bytes = new Uint8Array(readFileSync(full));
    if (!looksLike(ext, bytes)) throw new ProjectFsError("bad_image", `${shown} is not a valid ${ext} image`);
    return bytes;
  } catch (e) {
    throw fsError(e);
  }
}
