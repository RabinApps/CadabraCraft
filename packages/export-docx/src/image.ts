import { DocxExportError } from "./errors";

export interface ImageSize {
  width: number;
  height: number;
}

const u16be = (b: Uint8Array, i: number): number => (b[i]! << 8) | b[i + 1]!;
const u16le = (b: Uint8Array, i: number): number => b[i]! | (b[i + 1]! << 8);
const u24le = (b: Uint8Array, i: number): number => b[i]! | (b[i + 1]! << 8) | (b[i + 2]! << 16);
const u32be = (b: Uint8Array, i: number): number =>
  ((b[i]! << 24) | (b[i + 1]! << 16) | (b[i + 2]! << 8) | b[i + 3]!) >>> 0;
const ascii = (b: Uint8Array, i: number, n: number): string =>
  String.fromCharCode(...b.subarray(i, i + n));

function png(b: Uint8Array): ImageSize | null {
  if (b.length < 24 || b[0] !== 0x89 || ascii(b, 1, 3) !== "PNG" || ascii(b, 12, 4) !== "IHDR")
    return null;
  return { width: u32be(b, 16), height: u32be(b, 20) };
}

function jpeg(b: Uint8Array): ImageSize | null {
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) return null;
  let i = 2;
  while (i + 9 < b.length) {
    if (b[i] !== 0xff) {
      i++;
      continue;
    }
    const marker = b[i + 1]!;
    if (marker === 0xff) {
      i++;
      continue;
    }
    // Standalone markers have no length.
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd9)) {
      i += 2;
      continue;
    }
    const isSof =
      marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isSof) return { height: u16be(b, i + 5), width: u16be(b, i + 7) };
    i += 2 + u16be(b, i + 2);
  }
  return null;
}

function gif(b: Uint8Array): ImageSize | null {
  if (b.length < 10 || ascii(b, 0, 3) !== "GIF") return null;
  return { width: u16le(b, 6), height: u16le(b, 8) };
}

function webp(b: Uint8Array): ImageSize | null {
  if (b.length < 30 || ascii(b, 0, 4) !== "RIFF" || ascii(b, 8, 4) !== "WEBP") return null;
  const kind = ascii(b, 12, 4);
  if (kind === "VP8 ") return { width: u16le(b, 26) & 0x3fff, height: u16le(b, 28) & 0x3fff };
  if (kind === "VP8L") {
    const bits = b[21]! | (b[22]! << 8) | (b[23]! << 16) | (b[24]! << 24);
    return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
  }
  if (kind === "VP8X") return { width: u24le(b, 24) + 1, height: u24le(b, 27) + 1 };
  return null;
}

/** Pixel size read from the file header. Throws `DocxExportError` when the bytes are not the image type the extension says. */
export function imageSize(
  bytes: Uint8Array,
  mediaType: string,
  src: string,
  chapter?: string,
): ImageSize {
  const size =
    mediaType === "image/png"
      ? png(bytes)
      : mediaType === "image/jpeg"
        ? jpeg(bytes)
        : mediaType === "image/gif"
          ? gif(bytes)
          : mediaType === "image/webp"
            ? webp(bytes)
            : null;
  if (!size || size.width < 1 || size.height < 1) {
    throw new DocxExportError(
      `The image ${src} is not a readable ${mediaType.replace("image/", "").toUpperCase()} file`,
      { chapter, node: "image" },
    );
  }
  return size;
}
