import { readFileSync, statSync } from "node:fs";
import { ProjectFsError, fsError, isNotFound } from "./errors";
import { atomicWrite, hashBytes } from "./files";
import { fileBaseName, fileExtension, resolveSafe } from "./paths";

/** Image types that may be imported into `assets/` (keep in sync with `IMAGE_EXTENSIONS` in packages/shared). */
export const IMAGE_EXTENSIONS = ["png", "jpg", "jpeg", "gif", "webp", "svg"] as const;
/** Largest image accepted, in bytes. */
export const MAX_IMAGE_BYTES = 25 * 1024 * 1024;
const MAX_MB = MAX_IMAGE_BYTES / 1024 / 1024;

/** Allowlisted image extension (lower-case) of a file name, or null. */
export function imageExt(name: string): string | null {
  const ext = fileExtension(name);
  return ext && (IMAGE_EXTENSIONS as readonly string[]).includes(ext) ? ext : null;
}

const startsWith = (b: Uint8Array, sig: readonly number[]): boolean => b.length >= sig.length && sig.every((v, i) => b[i] === v);
const ascii = (s: string): number[] => Array.from(s, (c) => c.charCodeAt(0));

/** Cheap signature check so a renamed non-image is refused. SVG must at least look like SVG text. */
export function looksLike(ext: string, b: Uint8Array): boolean {
  switch (ext) {
    case "png":
      return startsWith(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    case "jpg":
    case "jpeg":
      return startsWith(b, [0xff, 0xd8, 0xff]);
    case "gif":
      return startsWith(b, ascii("GIF87a")) || startsWith(b, ascii("GIF89a"));
    case "webp":
      return b.length > 12 && startsWith(b, ascii("RIFF")) && startsWith(b.subarray(8), ascii("WEBP"));
    case "svg":
      try {
        return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(b).includes("<svg");
      } catch {
        return false;
      }
    default:
      return false;
  }
}

/** Reduces a file name stem to `[A-Za-z0-9_-]` (runs of other characters become one `-`), at most 80 chars; empty -> `image`. */
export function sanitizeAssetStem(stem: string): string {
  let out = "";
  for (const c of stem) {
    const ch = /[A-Za-z0-9_]/.test(c) ? c : "-";
    if (ch === "-" && (out === "" || out.endsWith("-"))) continue;
    out += ch;
  }
  out = out.replace(/-+$/, "");
  out = Array.from(out).slice(0, 80).join("");
  return out === "" ? "image" : out;
}

/**
 * Validates image bytes (allowlisted extension, size, signature) and stores them in `assets/` under a sanitised,
 * de-duplicated name: identical bytes reuse the existing file, different bytes get `-2`, `-3`... Never overwrites.
 */
export function storeImage(root: string, fileName: string, bytes: Uint8Array): string {
  const ext = imageExt(fileName);
  if (!ext) throw new ProjectFsError("unsupported_image", `unsupported image type: ${fileName}`);
  if (bytes.length > MAX_IMAGE_BYTES) throw new ProjectFsError("too_large", `${fileName} is larger than ${MAX_MB} MB`);
  if (!looksLike(ext, bytes)) throw new ProjectFsError("bad_image", `${fileName} is not a valid ${ext} image`);
  const dot = fileName.lastIndexOf(".");
  const stem = sanitizeAssetStem(dot >= 0 ? fileName.slice(0, dot) : fileName);
  const hash = hashBytes(bytes);
  for (let n = 1; ; n++) {
    const rel = `assets/${n === 1 ? `${stem}.${ext}` : `${stem}-${n}.${ext}`}`;
    const path = resolveSafe(root, rel);
    try {
      if (hashBytes(readFileSync(path)) === hash) return rel;
    } catch (e) {
      if (!isNotFound(e)) throw fsError(e);
      atomicWrite(path, bytes);
      return rel;
    }
  }
}

/** Copies an image the user picked (absolute path) into `assets/` and returns its project-relative path. */
export function importImage(root: string, sourcePath: string): string {
  const fileName = fileBaseName(sourcePath);
  if (!fileName) throw new ProjectFsError("unsupported_image", "invalid file name");
  if (!imageExt(fileName)) throw new ProjectFsError("unsupported_image", `unsupported image type: ${fileName}`);
  let size: number;
  try {
    const st = statSync(sourcePath);
    if (!st.isFile()) throw new ProjectFsError("not_a_file", `${fileName} is not a file`);
    size = st.size;
  } catch (e) {
    throw fsError(e, fileName);
  }
  if (size > MAX_IMAGE_BYTES) throw new ProjectFsError("too_large", `${fileName} is larger than ${MAX_MB} MB`);
  try {
    return storeImage(root, fileName, readFileSync(sourcePath));
  } catch (e) {
    throw fsError(e, fileName);
  }
}

/** Reads an asset's bytes for display or export. Only `assets/<image>` paths are served. */
export function readAsset(root: string, rel: string): Uint8Array {
  if (!rel.startsWith("assets/") || !imageExt(rel)) throw new ProjectFsError("unsupported_image", `not an image asset: ${rel}`);
  const path = resolveSafe(root, rel);
  try {
    if (statSync(path).size > MAX_IMAGE_BYTES) throw new ProjectFsError("too_large", `${rel} is too large`);
    return new Uint8Array(readFileSync(path));
  } catch (e) {
    throw fsError(e, rel);
  }
}
