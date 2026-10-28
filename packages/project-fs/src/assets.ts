import { readFileSync } from "node:fs";
import { ProjectFsError, fsError, isNotFound } from "./errors";
import { atomicWrite, hashBytes, readRegular } from "./files";
import { fileBaseName, fileExtension, resolveSafe } from "./paths";

/** Image types that may be imported into `assets/` (keep in sync with `IMAGE_EXTENSIONS` in packages/shared). */
export const IMAGE_EXTENSIONS = ["png", "jpg", "jpeg", "gif", "webp", "svg"] as const;
/** Largest image accepted, in bytes. */
export const MAX_IMAGE_BYTES = 25 * 1024 * 1024;
const MAX_MB = MAX_IMAGE_BYTES / 1024 / 1024;
/** Largest image accepted, in pixels (150 megapixels): a small PNG can declare 60000 x 60000 and need 14 GB to decode. */
export const MAX_IMAGE_PIXELS = 150_000_000;

export const imageTooLarge = (name: string): ProjectFsError =>
  new ProjectFsError("too_large", `${name} is larger than ${MAX_MB} MB`);

/** Allowlisted image extension (lower-case) of a file name, or null. */
export function imageExt(name: string): string | null {
  const ext = fileExtension(name);
  return ext && (IMAGE_EXTENSIONS as readonly string[]).includes(ext) ? ext : null;
}

const startsWith = (b: Uint8Array, sig: readonly number[]): boolean =>
  b.length >= sig.length && sig.every((v, i) => b[i] === v);
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
      return (
        b.length > 12 && startsWith(b, ascii("RIFF")) && startsWith(b.subarray(8), ascii("WEBP"))
      );
    case "svg":
      try {
        return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true })
          .decode(b)
          .includes("<svg");
      } catch {
        return false;
      }
    default:
      return false;
  }
}

/**
 * Width and height from the image header (PNG, GIF, JPEG, WebP), without decoding. Null when the header is cut short,
 * unknown or the type has no pixel size (SVG). Same rules as `image_size` in the Rust layer (fixtures/contract/image-dimensions.json).
 */
export function imageSize(ext: string, b: Uint8Array): [number, number] | null {
  // v8 ignore next -- every caller checks the length before reading, so the fallback never applies
  const u = (i: number): number => b[i] ?? 0;
  const be16 = (i: number): number | null => (i + 2 <= b.length ? (u(i) << 8) | u(i + 1) : null);
  const le16 = (i: number): number | null => (i + 2 <= b.length ? u(i) | (u(i + 1) << 8) : null);
  const be32 = (i: number): number | null =>
    i + 4 <= b.length ? ((u(i) << 24) | (u(i + 1) << 16) | (u(i + 2) << 8) | u(i + 3)) >>> 0 : null;
  const le24 = (i: number): number | null =>
    i + 3 <= b.length ? u(i) | (u(i + 1) << 8) | (u(i + 2) << 16) : null;
  const tag = (i: number, s: string): boolean =>
    i + s.length <= b.length && startsWith(b.subarray(i), ascii(s));
  const pair = (w: number | null, h: number | null): [number, number] | null =>
    w === null || h === null ? null : [w, h];
  switch (ext) {
    case "png":
      return tag(12, "IHDR") ? pair(be32(16), be32(20)) : null;
    case "gif":
      return pair(le16(6), le16(8));
    case "jpg":
    case "jpeg": {
      let i = 2;
      while (i + 4 <= b.length) {
        if (u(i) !== 0xff) return null;
        const m = u(i + 1);
        if (m === 0xff)
          i += 1; // fill byte
        else if (m === 0x01 || (m >= 0xd0 && m <= 0xd8)) i += 2;
        else if (m === 0xd9 || m === 0xda)
          return null; // end of image / start of scan: no frame header seen
        else if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc)
          return pair(be16(i + 7), be16(i + 5));
        else {
          i += 2 + ((u(i + 2) << 8) | u(i + 3)); // the loop guard (i + 4 <= length) keeps both bytes in range
        }
      }
      return null;
    }
    case "webp": {
      if (tag(12, "VP8X")) {
        const w = le24(24);
        const h = le24(27);
        return w === null || h === null ? null : [w + 1, h + 1];
      }
      if (tag(12, "VP8 ")) {
        const w = le16(26);
        const h = le16(28);
        return w === null || h === null ? null : [w & 0x3fff, h & 0x3fff];
      }
      if (tag(12, "VP8L")) {
        if (b.length < 25) return null;
        const bits = (u(21) | (u(22) << 8) | (u(23) << 16) | (u(24) << 24)) >>> 0;
        return [(bits & 0x3fff) + 1, ((bits >>> 14) & 0x3fff) + 1];
      }
      return null;
    }
    default:
      return null;
  }
}

/** Signature and pixel-count check shared by every way an image enters the project (picker, document import, preview). */
export function checkImage(name: string, ext: string, bytes: Uint8Array): void {
  if (!looksLike(ext, bytes))
    throw new ProjectFsError("bad_image", `${name} is not a valid ${ext} image`);
  const size = imageSize(ext, bytes);
  if (size && size[0] * size[1] > MAX_IMAGE_PIXELS) {
    throw new ProjectFsError(
      "image_dimensions",
      `${name} has more than ${MAX_IMAGE_PIXELS / 1_000_000} megapixels`,
    );
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
  if (bytes.length > MAX_IMAGE_BYTES)
    throw new ProjectFsError("too_large", `${fileName} is larger than ${MAX_MB} MB`);
  checkImage(fileName, ext, bytes);
  const stem = sanitizeAssetStem(fileName.slice(0, fileName.lastIndexOf(".")));
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
  if (!imageExt(fileName))
    throw new ProjectFsError("unsupported_image", `unsupported image type: ${fileName}`);
  return storeImage(
    root,
    fileName,
    readRegular(sourcePath, MAX_IMAGE_BYTES, fileName, () => imageTooLarge(fileName)),
  );
}

/** Reads an asset's bytes for display or export. Only `assets/<image>` paths are served. */
export function readAsset(root: string, rel: string): Uint8Array {
  if (!rel.startsWith("assets/") || !imageExt(rel))
    throw new ProjectFsError("unsupported_image", `not an image asset: ${rel}`);
  const path = resolveSafe(root, rel);
  return readRegular(path, MAX_IMAGE_BYTES, rel, () => imageTooLarge(rel));
}
