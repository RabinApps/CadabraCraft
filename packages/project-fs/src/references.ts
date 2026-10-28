import {
  closeSync,
  fchmodSync,
  fstatSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  renameSync,
  rmSync,
  statSync,
  writeSync,
} from "node:fs";
import { createHash, randomBytes } from "node:crypto";
import { join } from "node:path";
import { ProjectFsError, fsError } from "./errors";
import { checkImage, sanitizeAssetStem } from "./assets";
import { openError } from "./files";
import { fileBaseName, resolveSafe } from "./paths";

/**
 * Reference files (research material kept in `references/`): the import rules, mirroring
 * apps/desktop/src-tauri/src/project/references.rs (`import_reference`). The manifest list is in `@cadabracraft/format`.
 */

export type ReferenceKind = "image" | "video" | "audio" | "pdf" | "text" | "other";

const MB = 1024 * 1024;
/** Bytes of a file's start used for the signature check. */
const HEADER_BYTES = 64 * 1024;
const CHUNK = 256 * 1024;
export const REFERENCES_DIR = "references";

/** Programs, scripts, installers and web pages: they could run, or run script, when opened, so they are never imported. */
export const BLOCKED_REFERENCE_EXTENSIONS: readonly string[] = [
  "exe",
  "bat",
  "cmd",
  "com",
  "msi",
  "scr",
  "app",
  "dmg",
  "pkg",
  "sh",
  "command",
  "ps1",
  "vbs",
  "jar",
  "dll",
  "lnk",
  "appimage",
  "apk",
  "js",
  "mjs",
  "cjs",
  "html",
  "htm",
  "xhtml",
  "hta",
  "reg",
  "inf",
  "deb",
  "rpm",
  "bin",
  "run",
  "wsf",
];

const KINDS: Record<string, ReferenceKind> = {
  png: "image",
  jpg: "image",
  jpeg: "image",
  gif: "image",
  webp: "image",
  svg: "image",
  mp4: "video",
  m4v: "video",
  mov: "video",
  webm: "video",
  mp3: "audio",
  wav: "audio",
  ogg: "audio",
  oga: "audio",
  m4a: "audio",
  flac: "audio",
  pdf: "pdf",
  txt: "text",
  md: "text",
  markdown: "text",
};

/** Kind of a file from its (lower-case) extension; anything unknown is `other`. */
export const referenceKind = (ext: string): ReferenceKind =>
  Object.hasOwn(KINDS, ext) ? KINDS[ext]! : "other";

/** Largest file accepted for a kind, in bytes. */
export function maxReferenceBytes(kind: ReferenceKind): number {
  switch (kind) {
    case "video":
      return 500 * MB;
    case "audio":
    case "pdf":
      return 200 * MB;
    case "image":
    case "other":
      return 100 * MB;
    case "text":
      return 5 * MB;
  }
}

const tooLarge = (name: string, kind: ReferenceKind): ProjectFsError =>
  new ProjectFsError("too_large", `${name} is larger than ${maxReferenceBytes(kind) / MB} MB`);

const unsupported = (name: string): ProjectFsError =>
  new ProjectFsError("unsupported_reference", `unsupported reference type: ${name}`);

/** Lower-case extension, or "" for none. Anything other than 1 to 10 ASCII letters and digits is refused (like the Rust layer). */
function extensionOf(name: string): string {
  const i = name.lastIndexOf(".");
  if (i < 0) return "";
  const ext = name.slice(i + 1).replace(/[A-Z]/g, (c) => c.toLowerCase());
  if (!/^[a-z0-9]{1,10}$/.test(ext)) throw unsupported(name);
  return ext;
}

const startsAt = (b: Uint8Array, at: number, sig: string | number[]): boolean => {
  const s = typeof sig === "string" ? Array.from(sig, (c) => c.charCodeAt(0)) : sig;
  return b.length >= at + s.length && s.every((v, i) => b[at + i] === v);
};

/** Signature check of the file start for the types that have one (images are checked with `checkImage`). */
function signatureOk(ext: string, h: Uint8Array): boolean {
  switch (ext) {
    case "svg":
      return Buffer.from(h).toString("utf8").includes("<svg");
    case "pdf":
      return Buffer.from(h.subarray(0, 1024 + 4)).includes("%PDF-");
    case "mp4":
    case "m4v":
    case "mov":
    case "m4a":
      return (
        h.length > 12 && ["ftyp", "moov", "mdat", "free", "wide"].some((t) => startsAt(h, 4, t))
      );
    case "webm":
      return startsAt(h, 0, [0x1a, 0x45, 0xdf, 0xa3]);
    case "mp3":
      return startsAt(h, 0, "ID3") || (h.length > 2 && h[0] === 0xff && (h[1]! & 0xe0) === 0xe0);
    case "wav":
      return startsAt(h, 0, "RIFF") && startsAt(h, 8, "WAVE");
    case "ogg":
    case "oga":
      return startsAt(h, 0, "OggS");
    default:
      return startsAt(h, 0, "fLaC"); // flac: the caller only asks about the extensions above
  }
}

/** What an import reports: the project-relative file, a title to start from, the size, the kind, and whether an identical file was reused. */
export interface ImportedReference {
  file: string;
  title: string;
  size: number;
  kind: ReferenceKind;
  reused: boolean;
}

/** A readable stem for the name on disk: `[A-Za-z0-9_-]` only, "file" when nothing alphanumeric is left. */
const stemFor = (stem: string): string =>
  /[A-Za-z0-9]/.test(stem) ? sanitizeAssetStem(stem) : "file";

/** Copies `fd` to a new temp file chunk by chunk while hashing, refusing as soon as more than `cap` bytes were read. */
function copyCapped(
  src: number,
  dst: number,
  cap: number,
  tooBig: () => ProjectFsError,
): { size: number; hash: string; header: Uint8Array } {
  const hasher = createHash("sha256");
  const buf = Buffer.allocUnsafe(CHUNK);
  const header = Buffer.allocUnsafe(HEADER_BYTES);
  let size = 0;
  let kept = 0;
  for (;;) {
    const n = readSync(src, buf, 0, CHUNK, null);
    if (n === 0) return { size, hash: hasher.digest("hex"), header: header.subarray(0, kept) };
    size += n;
    if (size > cap) throw tooBig();
    if (kept < HEADER_BYTES) kept += buf.copy(header, kept, 0, Math.min(n, HEADER_BYTES - kept));
    hasher.update(buf.subarray(0, n));
    writeSync(dst, buf, 0, n);
  }
}

/**
 * Copies a file (absolute path) into `references/` and returns where it went. Streams the copy while hashing it, checks
 * the type, the per-kind size cap and the signature, and never overwrites: identical bytes reuse the existing file,
 * different bytes get a `-2`, `-3`... suffix. Same rules as `import_reference` in the Rust layer. The caller confines
 * `sourcePath` to the workspace.
 */
export function importReference(root: string, sourcePath: string): ImportedReference {
  const name = fileBaseName(sourcePath);
  if (!name) throw new ProjectFsError("unsupported_reference", "invalid file name");
  const ext = extensionOf(name);
  if (BLOCKED_REFERENCE_EXTENSIONS.includes(ext)) throw unsupported(name);
  const kind = referenceKind(ext);
  const cap = maxReferenceBytes(kind);
  const notFile = () => new ProjectFsError("not_a_file", `${name} is not a file`);
  let st;
  try {
    st = statSync(sourcePath);
  } catch (e) {
    throw openError(e, sourcePath, name);
  }
  if (!st.isFile()) throw notFile();
  if (st.size > cap) throw tooLarge(name, kind);

  let src = -1;
  let tmp: { path: string; fd: number } | null = null;
  try {
    try {
      src = openSync(sourcePath, "r");
    } catch (e) {
      throw openError(e, sourcePath, name);
    }
    // v8 ignore next -- guards a path swapped for a fifo or folder between the stat and the open; cannot be staged in a test
    if (!fstatSync(src).isFile()) throw notFile();
    const dir = resolveSafe(root, REFERENCES_DIR);
    try {
      mkdirSync(dir, { recursive: true });
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "EEXIST")
        throw new ProjectFsError("not_a_file", `${REFERENCES_DIR} is not a folder`);
      throw e;
    }
    const path = join(dir, `.${randomBytes(6).toString("hex")}.tmp`);
    tmp = { path, fd: openSync(path, "wx", 0o600) }; // never an existing file; 48 random bits
    let copied;
    try {
      copied = copyCapped(src, tmp.fd, cap, () => tooLarge(name, kind));
      fsyncSync(tmp.fd);
      fchmodSync(tmp.fd, 0o644);
    } finally {
      closeSync(tmp.fd);
    }
    const { size, hash, header } = copied;

    const invalid = () => new ProjectFsError("bad_reference", `${name} is not a valid ${ext} file`);
    if (kind === "image" && ext !== "svg") {
      try {
        checkImage(name, ext, header);
      } catch (e) {
        throw e instanceof ProjectFsError && e.code === "bad_image" ? invalid() : e;
      }
    } else if (kind === "text") {
      const bytes = readFileSync(tmp.path);
      if (!isUtf8(bytes) || bytes.includes(0)) throw invalid();
    } else if (kind !== "other" && !signatureOk(ext, header)) throw invalid();

    const dot = name.lastIndexOf(".");
    const stemText = dot < 0 ? name : name.slice(0, dot);
    const stem = stemFor(stemText);
    const title = stemText.trim() || stem;
    for (let n = 1; ; n++) {
      const base = n === 1 ? stem : `${stem}-${n}`;
      const rel = `${REFERENCES_DIR}/${ext ? `${base}.${ext}` : base}`;
      const path = resolveSafe(root, rel);
      let existing;
      try {
        existing = lstatSync(path);
      } catch {
        // Nothing there: the rename either succeeds or reports why it cannot.
        renameSync(tmp.path, path);
        tmp = null;
        return { file: rel, title, size, kind, reused: false };
      }
      if (existing.isFile() && existing.size === size && hashFile(path) === hash)
        return { file: rel, title, size, kind, reused: true };
    }
  } catch (e) {
    throw fsError(e, name);
  } finally {
    if (src >= 0) closeSync(src);
    if (tmp) rmSync(tmp.path, { force: true });
  }
}

/** sha256 of a file, read in chunks (a reference can be hundreds of megabytes). */
function hashFile(path: string): string {
  const hasher = createHash("sha256");
  const buf = Buffer.allocUnsafe(CHUNK);
  const fd = openSync(path, "r");
  try {
    for (let n = readSync(fd, buf, 0, CHUNK, null); n > 0; n = readSync(fd, buf, 0, CHUNK, null))
      hasher.update(buf.subarray(0, n));
  } finally {
    closeSync(fd);
  }
  return hasher.digest("hex");
}

function isUtf8(b: Uint8Array): boolean {
  try {
    new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(b);
    return true;
  } catch {
    return false;
  }
}
