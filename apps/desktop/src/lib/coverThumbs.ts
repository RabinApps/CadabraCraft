import { imageMediaType } from "@cadabracraft/shared";
import { bridge } from "./bridge";

/** Longest side of a stored thumbnail, in pixels. A cover card is at most ~200 CSS px wide, so this is sharp on a 2x screen. */
export const THUMB_PX = 240;

interface Stored {
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

const DB = "cadabracraft-covers";
const STORE = "thumbs";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("indexedDB"));
  });
}

async function withStore<T>(mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<T>) {
  const db = await openDb();
  try {
    return await new Promise<T>((resolve, reject) => {
      const req = run(db.transaction(STORE, mode).objectStore(STORE));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error ?? new Error("indexedDB"));
    });
  } finally {
    db.close();
  }
}

const idbStore: ThumbStore = {
  get: (key) => withStore("readonly", (s) => s.get(key) as IDBRequest<Stored | undefined>),
  put: async (key, value) => void (await withStore("readwrite", (s) => s.put(value, key))),
  delete: async (key) => void (await withStore("readwrite", (s) => s.delete(key))),
};

/** Downscales with a canvas. An `<img>` decodes every format the webview shows, SVG included. */
async function renderThumb(bytes: Uint8Array, type: string): Promise<Blob> {
  const source = URL.createObjectURL(new Blob([bytes as BlobPart], { type }));
  try {
    const img = new Image();
    img.src = source;
    await img.decode();
    const { w, h } = fitWithin(img.naturalWidth || THUMB_PX, img.naturalHeight || THUMB_PX);
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (ctx) {
      ctx.fillStyle = "#fff"; // JPEG has no transparency: a transparent cover would turn black
      ctx.fillRect(0, 0, w, h);
      ctx.drawImage(img, 0, 0, w, h);
    }
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("toBlob"))), "image/jpeg", 0.82),
    );
  } finally {
    URL.revokeObjectURL(source);
  }
}

export const coverThumbs = createCoverThumbs({
  store: idbStore,
  stamp: (root, cover) => bridge.statAsset(root, cover),
  read: (root, cover) => bridge.readAsset(root, cover),
  render: renderThumb,
  url: (blob) => URL.createObjectURL(blob),
});
