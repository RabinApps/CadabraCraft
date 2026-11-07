import { imageMediaType } from "@cadabracraft/shared";

/** Longest side of a stored thumbnail, in pixels. A cover card is at most ~200 CSS px wide, so this is sharp on a 2x screen. */
export const THUMB_PX = 240;

export interface Stored {
  size: number;
  modified: number;
  blob: Blob;
}

/** Where thumbnails live between sessions. The real one is IndexedDB; never the project folder and never localStorage. */
export interface ThumbStore {
  get(key: string): Promise<Stored | undefined>;
  put(key: string, value: Stored): Promise<void>;
  delete(key: string): Promise<void>;
}

export interface ThumbDeps {
  store: ThumbStore;
  stamp(root: string, cover: string): Promise<{ size: number; modified: number }>;
  /** Draws the cover bytes into a thumbnail no larger than `THUMB_PX`. */
  render(bytes: Uint8Array, type: string): Promise<Blob>;
  read(root: string, cover: string): Promise<Uint8Array>;
  url(blob: Blob): string;
}

/** The size that fits `w` x `h` into `max` on the longest side, never enlarging. */
export function fitWithin(w: number, h: number, max = THUMB_PX): { w: number; h: number } {
  const scale = Math.min(1, max / Math.max(w, h, 1));
  return { w: Math.max(1, Math.round(w * scale)), h: Math.max(1, Math.round(h * scale)) };
}

export const thumbKey = (root: string, cover: string) => `${root}\u0000${cover}`;

/**
 * The thumbnail cache: the stored thumbnail is used while the cover file's size and modification time are unchanged,
 * otherwise the cover is read once, downscaled and stored. Resolves to an object URL, or null when there is no cover to show
 * (missing file, unreadable image, no storage): the caller falls back to the typographic cover.
 */
export function createCoverThumbs(deps: ThumbDeps) {
  const urls = new Map<string, Promise<string | null>>();
  async function load(root: string, cover: string): Promise<string | null> {
    try {
      const now = await deps.stamp(root, cover);
      const key = thumbKey(root, cover);
      const hit = await deps.store.get(key).catch(() => undefined);
      if (hit && hit.size === now.size && hit.modified === now.modified) return deps.url(hit.blob);
      const type = imageMediaType(cover) ?? "application/octet-stream";
      const blob = await deps.render(await deps.read(root, cover), type);
      await deps.store.put(key, { ...now, blob }).catch(() => {});
      return deps.url(blob);
    } catch {
      return null;
    }
  }
  return {
    get(root: string, cover: string): Promise<string | null> {
      const key = thumbKey(root, cover);
      let p = urls.get(key);
      if (!p) {
        p = load(root, cover);
        urls.set(key, p);
        // A failure is not remembered: the file may appear later (a sync finishing).
        void p.then((u) => u === null && urls.delete(key));
      }
      return p;
    },
    /** Forgets a book's thumbnail (it was removed from the Library). */
    async forget(root: string, cover: string): Promise<void> {
      const key = thumbKey(root, cover);
      const had = urls.get(key);
      urls.delete(key);
      void had?.then((u) => u && URL.revokeObjectURL(u));
      await deps.store.delete(key).catch(() => {});
    },
  };
}
