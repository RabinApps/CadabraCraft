// Read-only access to files picked for import. Nothing here writes next to the source file.
//
// Text types are returned as raw bytes: BOMs, UTF-16 and invalid UTF-8 pass through untouched (the importer decodes).
// Every failure is a ProjectFsError with a stable code (same wording as the Rust layer, src-tauri/src/import_src.rs).
import { realpathSync } from "node:fs";
import { dirname, isAbsolute, join } from "node:path";
import { MAX_IMAGE_BYTES, checkImage, imageExt, imageTooLarge } from "./assets";
import { ProjectFsError, fsError } from "./errors";
import { icloudPending, openError, readRegular } from "./files";
import { fileBaseName, fileExtension, isInside } from "./paths";

/** Document types the importer understands. */
export const IMPORT_EXTENSIONS = ["docx", "md", "markdown", "html", "htm", "txt"] as const;
/** Largest source document accepted, in bytes. */
export const MAX_IMPORT_BYTES = 200 * 1024 * 1024;
const MAX_IMPORT_MB = MAX_IMPORT_BYTES / 1024 / 1024;

/** A path from outside must be absolute: a relative one would resolve against wherever the process happens to run. */
function requireAbsolute(path: string): void {
  if (!isAbsolute(path)) throw new ProjectFsError("unsafe_path", `unsafe project path: ${fileBaseName(path) || path}`);
}

/**
 * Reads a document the user picked (absolute path). Only allowlisted extensions (ASCII case-insensitive, the last
 * extension only: `a.html.exe`, `.html`, `a.` and `a.md ` are refused), regular files, capped size. A link the user
 * picked is followed, but it must lead to a regular file; folders, fifos and devices are never opened.
 */
export function readSource(path: string): Uint8Array {
  requireAbsolute(path);
  const name = fileBaseName(path);
  const ext = fileExtension(path) ?? "";
  if (!name || !(IMPORT_EXTENSIONS as readonly string[]).includes(ext)) {
    throw new ProjectFsError("unsupported_source", `${name || path} is not a .docx, .md, .markdown, .html, .htm or .txt file`);
  }
  return readRegular(path, MAX_IMPORT_BYTES, name, () => new ProjectFsError("too_large", `${name} is larger than ${MAX_IMPORT_MB} MB`));
}

/**
 * Reads an image a Markdown file references, relative to that file's folder. Refuses absolute paths, `..`, backslashes,
 * colons (drive prefixes, `file:` URLs, NTFS streams), NUL, symlinks that lead outside the folder, non-image
 * extensions, oversized files, content that is not the claimed type and absurd pixel counts.
 */
export function readRelativeImage(sourceFile: string, reference: string): Uint8Array {
  requireAbsolute(sourceFile);
  const shown = Array.from(reference).slice(0, 80).join("");
  const parts = reference.split("/");
  const safe = reference !== "" && !/[\\:\0]/.test(reference) && parts[0] !== "" && parts.every((p) => p !== "..");
  if (!safe) throw new ProjectFsError("unsafe_path", `image path is not allowed: ${shown}`);
  const ext = imageExt(reference);
  if (!ext) throw new ProjectFsError("unsupported_image", `unsupported image type: ${shown}`);
  const folder = dirname(sourceFile);
  let base: string;
  try {
    base = realpathSync(folder);
  } catch (e) {
    throw openError(e, folder, "the document folder");
  }
  const wanted = join(base, reference);
  let full: string;
  try {
    full = realpathSync(wanted);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "EACCES") throw fsError(e, shown);
    if (icloudPending(wanted)) throw new ProjectFsError("icloud_placeholder", `${shown} is still downloading from iCloud; try again in a moment`);
    throw new ProjectFsError("not_found", `image not found: ${shown}`); // missing, a loop, or a file where a folder should be
  }
  if (!isInside(base, full)) throw new ProjectFsError("path_escape", `image is outside the document folder: ${shown}`);
  const bytes = readRegular(full, MAX_IMAGE_BYTES, shown, () => imageTooLarge(shown));
  checkImage(shown, ext, bytes);
  return bytes;
}
