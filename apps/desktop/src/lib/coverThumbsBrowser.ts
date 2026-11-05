import { bridge } from "./bridge";
import {
  createCoverThumbs,
  fitWithin,
  THUMB_PX,
  type Stored,
  type ThumbStore,
} from "./coverThumbs";

// The browser half of the cover thumbnails: IndexedDB and a canvas, which unit tests cannot run (they are measured through Playwright:
// see docs/testing.md). The cache logic that decides when to render is in `coverThumbs.ts`.

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
