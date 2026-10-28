import { imageMediaType } from "@cadabracraft/shared";
import { bridge } from "./bridge";

// Object URLs per project + asset path. They are small, live for the session, and keep re-renders and chapter
// switches from re-reading the file.
const cache = new Map<string, Promise<string>>();

/** Turns a project-relative `assets/...` path into a blob URL the webview can display. Rejects if the file cannot be read. */
export function assetUrl(root: string, src: string): Promise<string> {
  const key = `${root}\u0000${src}`;
  let hit = cache.get(key);
  if (!hit) {
    hit = bridge.readAsset(root, src).then((bytes) =>
      URL.createObjectURL(
        new Blob([bytes as BlobPart], {
          type: imageMediaType(src) ?? "application/octet-stream",
        }),
      ),
    );
    hit.catch(() => cache.delete(key)); // a missing file may appear later (sync), so do not cache the failure
    cache.set(key, hit);
  }
  return hit;
}

/** Drops the cached URL for one asset, e.g. after it was replaced on disk. */
export function forgetAsset(root: string, src: string): void {
  const key = `${root}\u0000${src}`;
  cache.get(key)?.then(
    (u) => URL.revokeObjectURL(u),
    () => {},
  );
  cache.delete(key);
}
