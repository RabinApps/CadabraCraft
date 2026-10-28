import { bridge } from "./bridge";
import { referenceMediaType } from "./referenceKinds";

/** Bytes asked for per read; the backend caps one call at 16 MB. */
const CHUNK = 8 * 1024 * 1024;

/** Every byte of `references/<name>`, read in chunks so a large video never travels in one message. */
export async function readReferenceParts(root: string, file: string): Promise<Uint8Array[]> {
  const { size } = await bridge.statReference(root, file);
  const parts: Uint8Array[] = [];
  for (let offset = 0; offset < size;) {
    const part = await bridge.readReference(root, file, offset, CHUNK);
    if (part.length === 0) break; // the file shrank while it was read
    parts.push(part);
    offset += part.length;
  }
  return parts;
}

/** The whole file as one array (for the PDF viewer and text). */
export async function readReferenceBytes(root: string, file: string): Promise<Uint8Array> {
  const parts = await readReferenceParts(root, file);
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

// Object URLs per project + file, so reopening a viewer does not read a large file again.
const cache = new Map<string, Promise<string>>();
const keyOf = (root: string, file: string) => `${root}\u0000${file}`;

/** A blob URL for a reference file, for `<img>`, `<video>` and `<audio>`. A failed read is not cached. */
export function referenceUrl(root: string, file: string): Promise<string> {
  const key = keyOf(root, file);
  let hit = cache.get(key);
  if (!hit) {
    hit = readReferenceParts(root, file).then((parts) =>
      URL.createObjectURL(new Blob(parts as BlobPart[], { type: referenceMediaType(file) })),
    );
    hit.catch(() => cache.delete(key));
    cache.set(key, hit);
  }
  return hit;
}

const revoke = (hit: Promise<string> | undefined) =>
  hit?.then(
    (u) => URL.revokeObjectURL(u),
    () => {},
  );

/** Drops one file's cached URL (it was removed or replaced). */
export function forgetReference(root: string, file: string): void {
  revoke(cache.get(keyOf(root, file)));
  cache.delete(keyOf(root, file));
}

/** Revokes every cached URL of one project, so a closed book does not keep its files in memory. */
export function forgetProjectReferences(root: string): void {
  const prefix = `${root}\u0000`;
  for (const key of [...cache.keys()]) {
    if (!key.startsWith(prefix)) continue;
    revoke(cache.get(key));
    cache.delete(key);
  }
}
