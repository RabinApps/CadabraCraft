import { imageMediaType, isAssetPath } from "@cadabracraft/shared";
import { checkText, fail } from "./helpers";
import { esc } from "./text";
import { PAGE_HEIGHT, TEXT_WIDTH } from "./layout";
import type { Ctx } from "./types";

const u16be = (b: Uint8Array, i: number): number => (b[i]! << 8) | b[i + 1]!;
const u32be = (b: Uint8Array, i: number): number =>
  ((b[i]! << 24) | (b[i + 1]! << 16) | (b[i + 2]! << 8) | b[i + 3]!) >>> 0;
const ascii = (b: Uint8Array, i: number, n: number): string =>
  String.fromCharCode(...b.subarray(i, i + n));

interface ImageSize {
  width: number;
  height: number;
}

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

const TWIPS_PER_PX = 15; // 96 dpi
const HUNDREDTH_MM_PER_PX = 26.458;
const MAX_H = PAGE_HEIGHT - 2 * 1440;
const LINE = 64; // bytes of picture data per line

/**
 * An embedded picture (`\pict`). RTF has PNG and JPEG blips only: GIF, WebP and SVG throw with a hint, as does a file whose
 * bytes are not the type its extension says. Wide images are scaled down to the text width; the data is lowercase hex.
 * A non-empty `alt` is written the way Word writes a picture's alternative text: a `\*\picprop` group (shape properties of the
 * picture) holding the `wzDescription` property. An empty `alt` (a decorative image) writes nothing.
 */
export function picture(src: string, ctx: Ctx, alt = ""): string {
  if (!isAssetPath(src))
    fail(ctx, `The image source "${src}" is not a project image (assets/<file>)`, "image");
  const type = imageMediaType(src);
  if (!type) fail(ctx, `The image ${src} has an unsupported type`, "image");
  if (type !== "image/png" && type !== "image/jpeg")
    fail(
      ctx,
      `The image ${src} is ${type === "image/svg+xml" ? "an SVG" : `a ${type.slice(6).toUpperCase()}`}, which cannot be embedded in an RTF file. Use a PNG or JPEG instead`,
      "image",
    );
  const bytes = ctx.s.assets.get(src);
  if (!bytes) fail(ctx, `The image file ${src} is missing`, "image");
  const size = type === "image/png" ? png(bytes) : jpeg(bytes);
  if (!size || size.width < 1 || size.height < 1)
    fail(ctx, `The image ${src} is not a readable ${type.slice(6).toUpperCase()} file`, "image");
  const scale = Math.min(
    1,
    TEXT_WIDTH / (size.width * TWIPS_PER_PX),
    MAX_H / (size.height * TWIPS_PER_PX),
  );
  const goalW = Math.max(1, Math.round(size.width * TWIPS_PER_PX * scale));
  const goalH = Math.max(1, Math.round(size.height * TWIPS_PER_PX * scale));
  const hex = Array.from(bytes, (v) => v.toString(16).padStart(2, "0")).join("");
  const lines = hex.match(new RegExp(`.{1,${LINE * 2}}`, "g"))!.join("\n");
  const description = checkText(alt.trim(), ctx, "An image description");
  const props =
    description === ""
      ? ""
      : `{\\*\\picprop\\shplid1025{\\sp{\\sn shapeType}{\\sv 75}}{\\sp{\\sn wzDescription}{\\sv ${esc(description)}}}}`;
  return `{\\pict${props}${type === "image/png" ? "\\pngblip" : "\\jpegblip"}\\picw${Math.round(size.width * HUNDREDTH_MM_PER_PX)}\\pich${Math.round(size.height * HUNDREDTH_MM_PER_PX)}\\picwgoal${goalW}\\pichgoal${goalH}\n${lines}}`;
}
