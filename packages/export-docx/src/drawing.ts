import { imageMediaType, isAssetPath } from "@cadabracraft/shared";
import { imageSize } from "./image";
import { PAGE, TEXT_WIDTH } from "./parts";
import { esc } from "./xml";
import { checkText, fail } from "./helpers";
import { addRel } from "./paragraphs";
import type { Ctx } from "./types";

export const NS_WP = "http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing";
export const NS_A = "http://schemas.openxmlformats.org/drawingml/2006/main";
export const NS_PIC = "http://schemas.openxmlformats.org/drawingml/2006/picture";
const EMU_PER_PX = 9525; // 96 dpi
const MAX_W_EMU = (TEXT_WIDTH / 1440) * 914400;
const MAX_H_EMU = ((PAGE.height - 2 * PAGE.margin) / 1440) * 914400;

export function drawing(src: string, alt: string, title: string, ctx: Ctx): string {
  const s = ctx.s;
  if (!isAssetPath(src)) fail(ctx, `The image source "${src}" is not a project image (assets/<file>)`, "image");
  const type = imageMediaType(src);
  if (!type) fail(ctx, `The image ${src} has an unsupported type`, "image");
  if (type === "image/svg+xml") fail(ctx, `The image ${src} is an SVG, which cannot be embedded in a Word file. Use a PNG or JPEG instead`, "image");
  const bytes = s.assets.get(src);
  if (!bytes) fail(ctx, `The image file ${src} is missing`, "image");
  const { width, height } = imageSize(bytes, type, src, ctx.chapter);
  let m = s.media.get(src);
  if (!m) {
    const ext = src.slice(src.lastIndexOf(".") + 1).toLowerCase();
    const name = `image${s.media.size + 1}.${ext}`;
    m = { name, rel: addRel(ctx, "image", `media/${name}`) };
    s.media.set(src, m);
    s.mediaTypes.set(ext, type);
  }
  let cx = width * EMU_PER_PX;
  let cy = height * EMU_PER_PX;
  const scale = Math.min(1, MAX_W_EMU / cx, MAX_H_EMU / cy);
  cx = Math.max(1, Math.round(cx * scale));
  cy = Math.max(1, Math.round(cy * scale));
  const id = ++s.drawingId;
  const descr = esc(checkText(alt || title, ctx, "An image description"));
  const fileName = esc(src.slice(src.lastIndexOf("/") + 1));
  return `<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="${id}" name="Picture ${id}" descr="${descr}"/><wp:cNvGraphicFramePr><a:graphicFrameLocks noChangeAspect="1"/></wp:cNvGraphicFramePr><a:graphic><a:graphicData uri="${NS_PIC}"><pic:pic><pic:nvPicPr><pic:cNvPr id="${id}" name="${fileName}" descr="${descr}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${m.rel}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`;
}
