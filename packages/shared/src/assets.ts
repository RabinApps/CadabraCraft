/** Image types the project accepts in `assets/` (keep in sync with `IMAGE_EXTENSIONS` in src-tauri/src/project). */
export const IMAGE_MEDIA_TYPES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
};

export const IMAGE_EXTENSIONS = Object.keys(IMAGE_MEDIA_TYPES);

/** Media type for an image path, or null when the extension is not an allowed image type. */
export function imageMediaType(path: string): string | null {
  const ext = /\.([A-Za-z0-9]+)$/.exec(path)?.[1]?.toLowerCase();
  return (ext && IMAGE_MEDIA_TYPES[ext]) || null;
}

/** True for project-relative `assets/<file>` paths (one level, no `..`, no backslashes). */
export const isAssetPath = (src: string): boolean =>
  /^assets\/[^/\\]+$/.test(src) && !src.includes("..");
