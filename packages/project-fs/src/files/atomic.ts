import { createHash, randomBytes } from "node:crypto";
import {
  closeSync,
  existsSync,
  fchmodSync,
  fstatSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readSync,
  renameSync,
  rmSync,
  statSync,
  writeSync,
} from "node:fs";
import { basename, dirname, join } from "node:path";
import { ProjectFsError, fsError } from "../errors";

export const hashBytes = (b: Uint8Array): string => createHash("sha256").update(b).digest("hex");

/**
 * Writes to a uniquely named `.<random>.tmp` in the same directory (never one that exists: `wx`), fsyncs, then renames,
 * so a crash or sync never leaves a half-written file and concurrent writers never share a temp file. The existing
 * file's mode is kept (0644 for a new one). The temp file is removed on any failure. A folder where the file should go,
 * or a file where a folder should be, is `not_a_file`, like the Rust layer.
 */
export function atomicWrite(path: string, bytes: Uint8Array): void {
  const dir = dirname(path);
  const label = basename(path);
  try {
    if (lstatSync(path, { throwIfNoEntry: false })?.isDirectory())
      throw new ProjectFsError("not_a_file", `${label} is not a file`);
    try {
      mkdirSync(dir, { recursive: true });
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code;
      if (code === "EEXIST" || code === "ENOTDIR")
        throw new ProjectFsError("not_a_file", `${basename(dir)} is not a folder`);
      throw e;
    }
  } catch (e) {
    throw fsError(e, label);
  }
  let mode = 0o644;
  try {
    mode = statSync(path).mode & 0o7777;
  } catch {
    /* a new file */
  }
  let tmp = "";
  let fd = -1;
  try {
    for (let attempt = 0; fd < 0; attempt++) {
      tmp = join(dir, `.${randomBytes(6).toString("hex")}.tmp`);
      try {
        fd = openSync(tmp, "wx", 0o600);
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== "EEXIST" || attempt > 8) throw e;
      }
    }
    try {
      writeSync(fd, bytes);
      fsyncSync(fd);
      fchmodSync(fd, mode);
    } finally {
      closeSync(fd);
    }
    renameSync(tmp, path);
  } catch (e) {
    if (tmp) rmSync(tmp, { force: true });
    throw fsError(e, label);
  }
}

/** True when `path` is an iCloud placeholder that has not been downloaded: the real name is missing, `.<name>.icloud` is not. */
export const icloudPending = (path: string): boolean =>
  existsSync(join(dirname(path), `.${basename(path)}.icloud`));

/** Mirrors Rust `open_error`: a missing path is `icloud_placeholder` or `not_found`; anything else maps like `fsError`. */
export function openError(e: unknown, path: string, label: string): ProjectFsError {
  const code = (e as NodeJS.ErrnoException | undefined)?.code;
  if (code === "ENOENT" || code === "ENOTDIR") {
    return icloudPending(path)
      ? new ProjectFsError(
          "icloud_placeholder",
          `${label} is still downloading from iCloud; try again in a moment`,
        )
      : new ProjectFsError("not_found", `${label} does not exist`);
  }
  return fsError(e, label);
}

/**
 * Reads a regular file of at most `cap` bytes (mirrors Rust `read_regular`). A folder, fifo or device is `not_a_file`
 * without being opened (a fifo would block forever); the size is checked on the opened handle too, and the read is
 * capped at `cap + 1`, so a file that grows while it is read never uses unbounded memory. Links are followed.
 */
export function readRegular(
  path: string,
  cap: number,
  label: string,
  tooLarge: () => ProjectFsError,
): Uint8Array {
  const notFile = () => new ProjectFsError("not_a_file", `${label} is not a file`);
  let st;
  try {
    st = statSync(path);
  } catch (e) {
    throw openError(e, path, label);
  }
  if (!st.isFile()) throw notFile();
  if (st.size > cap) throw tooLarge();
  let fd: number;
  try {
    fd = openSync(path, "r");
  } catch (e) {
    throw openError(e, path, label);
  }
  try {
    const hst = fstatSync(fd);
    if (!hst.isFile()) throw notFile();
    if (hst.size > cap) throw tooLarge();
    let buf = Buffer.allocUnsafe(Math.min(cap + 1, hst.size + 1)); // one spare byte to notice growth
    let len = 0;
    for (;;) {
      if (len === buf.length) {
        if (buf.length > cap) throw tooLarge(); // read `cap + 1` bytes: the file is over the cap
        const bigger = Buffer.allocUnsafe(Math.min(cap + 1, buf.length * 2));
        buf.copy(bigger, 0, 0, len);
        buf = bigger;
      }
      const n = readSync(fd, buf, len, buf.length - len, null);
      if (n === 0) return new Uint8Array(buf.subarray(0, len));
      len += n;
    }
  } catch (e) {
    throw fsError(e, label);
  } finally {
    closeSync(fd);
  }
}
