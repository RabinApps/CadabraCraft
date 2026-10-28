import type { ImportAsset } from "../types";
import type { Warnings } from "./warnings";
import { cleanText, textNode, type Item } from "./text";

/** Maps source image references to unique project-relative asset paths. */
export class AssetRegistry {
  readonly assets: ImportAsset[] = [];
  private bySource = new Map<string, ImportAsset>();
  private used = new Set<string>();

  register(sourcePath: string, mediaType?: string, bytes?: Uint8Array): ImportAsset {
    const hit = this.bySource.get(sourcePath);
    if (hit) return hit;
    // split() always returns at least one element, so the fallback is only there for the type checker.
    /* v8 ignore next -- @preserve */
    const base = sourcePath.split(/[\\/]/).pop() ?? "";
    let name = base.replace(/[^A-Za-z0-9._-]/g, "_").replace(/^\.+/, "");
    if (!name) name = "image";
    let target = `assets/${name}`;
    for (let i = 2; this.used.has(target.toLowerCase()); i++) {
      const dot = name.lastIndexOf(".");
      target = `assets/${dot > 0 ? `${name.slice(0, dot)}-${i}${name.slice(dot)}` : `${name}-${i}`}`;
    }
    this.used.add(target.toLowerCase());
    const asset: ImportAsset = {
      sourcePath,
      targetPath: target,
      ...(mediaType ? { mediaType } : {}),
      ...(bytes ? { bytes } : {}),
    };
    this.bySource.set(sourcePath, asset);
    this.assets.push(asset);
    return asset;
  }
}

export const IMAGE_TYPES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
};

export function extOf(path: string): string {
  const m = /\.([A-Za-z0-9]+)$/.exec(path);
  return m ? m[1]!.toLowerCase() : "";
}

/** An image reference as items: a lifted image block for a local file, or its alt text (with a warning) when it cannot be imported. */
export function imageItems(
  url: string,
  alt: string,
  title: string | null | undefined,
  line: number | undefined,
  ctx: { warn: Warnings; assets: AssetRegistry },
): Item[] {
  const u = url.trim();
  alt = cleanText(alt);
  if (/^https?:\/\//i.test(u) || u.startsWith("//")) {
    ctx.warn.at(
      "remote-image",
      "warning",
      `Remote image not imported (no network access): ${u.slice(0, 80)}`,
      line,
    );
  } else if (/^[a-z][a-z0-9+.-]*:/i.test(u) && !/^[a-z]:[\\/]/i.test(u)) {
    ctx.warn.at(
      "unsupported-image",
      "warning",
      `Image with a ${u.split(":")[0]}: URL was not imported.`,
      line,
    );
  } else {
    let path = u;
    try {
      path = decodeURI(u);
    } catch {
      /* keep raw */
    }
    // split() always returns at least one element, so the fallback is only there for the type checker.
    /* v8 ignore next -- @preserve */
    path = path.split(/[?#]/)[0] ?? path;
    const ext = extOf(path);
    if (!IMAGE_TYPES[ext]) {
      ctx.warn.at(
        "unsupported-image",
        "warning",
        `Image "${path.slice(0, 80)}" has an unsupported type and was not imported.`,
        line,
      );
    } else {
      const a = ctx.assets.register(path, IMAGE_TYPES[ext]);
      return [
        {
          sep: "block",
          node: {
            type: "image",
            attrs: {
              src: a.targetPath,
              alt: alt || null,
              title: title == null ? null : cleanText(title),
            },
          },
        },
      ];
    }
  }
  const t = textNode(alt ? `[Image: ${alt}]` : "");
  return t ? [t] : [];
}
