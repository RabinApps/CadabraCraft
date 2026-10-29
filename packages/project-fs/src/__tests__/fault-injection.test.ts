// Failures that a real temp folder cannot produce (a crash between two calls, a file that grows while it is read, a
// random name that collides): node:fs and node:crypto are wrapped so a test can make one call misbehave.
import { existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const fault = vi.hoisted(() => ({
  mkdir: null as Error | null,
  rename: null as Error | null,
  link: null as Error | null,
  beforeLink: null as null | ((to: string) => void),
  unlink: null as Error | null,
  fstat: null as null | ((real: { size: number; isFile(): boolean }) => unknown),
  stat: null as null | ((real: { size: number; isFile(): boolean }) => unknown),
  readSync: null as Error | null,
  realpath: null as Error | null,
  randomBytes: null as null | (() => Buffer),
}));

vi.mock("node:fs", async (orig) => {
  const real = await orig<typeof import("node:fs")>();
  return {
    ...real,
    mkdirSync: ((...a: Parameters<typeof real.mkdirSync>) => {
      if (fault.mkdir) throw fault.mkdir;
      return real.mkdirSync(...a);
    }) as typeof real.mkdirSync,
    renameSync: ((...a: Parameters<typeof real.renameSync>) => {
      if (fault.rename) throw fault.rename;
      return real.renameSync(...a);
    }) as typeof real.renameSync,
    linkSync: ((...a: Parameters<typeof real.linkSync>) => {
      fault.beforeLink?.(String(a[1]));
      if (fault.link) throw fault.link;
      return real.linkSync(...a);
    }) as typeof real.linkSync,
    unlinkSync: ((...a: Parameters<typeof real.unlinkSync>) => {
      if (fault.unlink) throw fault.unlink;
      return real.unlinkSync(...a);
    }) as typeof real.unlinkSync,
    statSync: ((...a: Parameters<typeof real.statSync>) => {
      const st = real.statSync(...a);
      return fault.stat ? fault.stat(st as never) : st;
    }) as typeof real.statSync,
    fstatSync: ((...a: Parameters<typeof real.fstatSync>) => {
      const st = real.fstatSync(...a);
      return fault.fstat ? fault.fstat(st as never) : st;
    }) as typeof real.fstatSync,
    readSync: ((...a: Parameters<typeof real.readSync>) => {
      if (fault.readSync) throw fault.readSync;
      return real.readSync(...a);
    }) as typeof real.readSync,
    realpathSync: Object.assign(
      (...a: Parameters<typeof real.realpathSync>) => {
        if (fault.realpath) throw fault.realpath;
        return real.realpathSync(...a);
      },
      { native: real.realpathSync.native },
    ) as typeof real.realpathSync,
  };
});

vi.mock("node:crypto", async (orig) => {
  const real = await orig<typeof import("node:crypto")>();
  return {
    ...real,
    randomBytes: ((n: number) =>
      fault.randomBytes ? fault.randomBytes() : real.randomBytes(n)) as typeof real.randomBytes,
  };
});

import { ProjectFsError, atomicWrite, readRegular, resolveReal, trashFile } from "../index";
import { renameNoReplace, syncDir } from "../files/atomic";

const tmp = () => mkdtempSync(join(tmpdir(), "pfs-fault-"));
const errno = (code: string) => Object.assign(new Error(`${code} injected`), { code });
const tooLarge = () => new ProjectFsError("too_large", "too big");
const code = (fn: () => unknown): string => {
  try {
    fn();
  } catch (e) {
    return e instanceof ProjectFsError ? e.code : `other:${String(e)}`;
  }
  return "none";
};
const noTemp = (dir: string) =>
  expect(readdirSync(dir).filter((n) => n.endsWith(".tmp"))).toEqual([]);

afterEach(() => {
  fault.mkdir = fault.rename = fault.readSync = fault.realpath = null;
  fault.fstat = fault.stat = fault.randomBytes = null;
  fault.link = fault.unlink = fault.beforeLink = null;
});

describe("atomicWrite under faults", () => {
  it("reports a folder that appears as a file between the checks", () => {
    const d = tmp();
    fault.mkdir = errno("EEXIST");
    expect(code(() => atomicWrite(join(d, "x.json"), new Uint8Array([1])))).toBe("not_a_file");
    fault.mkdir = errno("ENOTDIR");
    expect(code(() => atomicWrite(join(d, "x.json"), new Uint8Array([1])))).toBe("not_a_file");
    fault.mkdir = errno("EIO");
    expect(code(() => atomicWrite(join(d, "x.json"), new Uint8Array([1])))).toBe("io_error");
  });

  it("keeps the old file and leaves no temp file when the rename fails", () => {
    const d = tmp();
    const path = join(d, "x.json");
    writeFileSync(path, "old");
    fault.rename = errno("ENOSPC");
    expect(code(() => atomicWrite(path, new Uint8Array([1, 2])))).toBe("disk_full");
    fault.rename = null;
    expect(readdirSync(d)).toEqual(["x.json"]);
    noTemp(d);
  });

  it("tries another name when the random temp name is taken", () => {
    const d = tmp();
    writeFileSync(join(d, ".aaaaaaaaaaaa.tmp"), "taken");
    const names = [Buffer.from("aaaaaaaaaaaa", "hex"), Buffer.from("bbbbbbbbbbbb", "hex")];
    fault.randomBytes = () => names.shift()!;
    atomicWrite(join(d, "x.json"), new Uint8Array([7]));
    expect(readdirSync(d).sort()).toEqual([".aaaaaaaaaaaa.tmp", "x.json"]);
  });

  it("gives up when every temp name is taken", () => {
    const d = tmp();
    writeFileSync(join(d, ".aaaaaaaaaaaa.tmp"), "taken");
    fault.randomBytes = () => Buffer.from("aaaaaaaaaaaa", "hex");
    expect(code(() => atomicWrite(join(d, "x.json"), new Uint8Array([7])))).toBe("io_error");
    // Not asserted: atomicWrite removes `tmp` on failure, which here is the other writer's colliding file.
  });

  it("reports a failure before any temp name exists without touching the folder", () => {
    const d = tmp();
    fault.randomBytes = () => {
      throw errno("EIO");
    };
    expect(code(() => atomicWrite(join(d, "x.json"), new Uint8Array([7])))).toBe("io_error");
    expect(readdirSync(d)).toEqual([]);
  });
});

describe("readRegular under faults", () => {
  const file = () => {
    const d = tmp();
    const p = join(d, "f.bin");
    writeFileSync(p, Buffer.alloc(10, 1));
    return p;
  };

  it("refuses a handle that is not a regular file", () => {
    fault.fstat = (st) => ({ size: st.size, isFile: () => false });
    expect(code(() => readRegular(file(), 100, "f.bin", tooLarge))).toBe("not_a_file");
  });

  it("refuses a file that grew past the cap after the first check", () => {
    fault.fstat = () => ({ size: 1000, isFile: () => true });
    expect(code(() => readRegular(file(), 100, "f.bin", tooLarge))).toBe("too_large");
  });

  it("keeps reading a file that grew after it was measured", () => {
    fault.fstat = () => ({ size: 0, isFile: () => true });
    expect(readRegular(file(), 100, "f.bin", tooLarge)).toEqual(new Uint8Array(10).fill(1));
  });

  it("stops at the cap when a file keeps growing", () => {
    fault.stat = (st) => ({ size: 0, isFile: () => st.isFile() });
    fault.fstat = () => ({ size: 0, isFile: () => true });
    expect(code(() => readRegular(file(), 5, "f.bin", tooLarge))).toBe("too_large");
  });

  it("maps a read failure and still closes the handle", () => {
    fault.readSync = errno("EIO");
    expect(code(() => readRegular(file(), 100, "f.bin", tooLarge))).toBe("io_error");
  });
});

describe("trashFile under faults", () => {
  it("keeps the file where it was when the move fails", () => {
    const d = tmp();
    writeFileSync(join(d, "a.json"), "x");
    fault.link = errno("EXDEV");
    fault.rename = errno("EXDEV");
    expect(code(() => trashFile(d, "a.json"))).toBe("io_error");
    fault.rename = null;
    fault.link = null;
    expect(readdirSync(d)).toContain("a.json");
  });

  it("uses the next name when another writer takes the chosen one first, and never replaces it", () => {
    const d = tmp();
    writeFileSync(join(d, "a.json"), "mine");
    const at = new Date(Date.UTC(2026, 0, 2, 3, 4));
    let raced = "";
    fault.beforeLink = (to) => {
      if (raced) return;
      raced = to;
      writeFileSync(to, "theirs");
    };
    const t = trashFile(d, "a.json", at);
    expect(t).toBe(".cadabra/trash/20260102-0304-a-2.json");
    expect(readFileSync(raced, "utf8")).toBe("theirs");
    expect(readFileSync(join(d, t), "utf8")).toBe("mine");
    expect(existsSync(join(d, "a.json"))).toBe(false);
  });

  it("gives up after a bounded number of lost races and keeps the file", () => {
    const d = tmp();
    writeFileSync(join(d, "a.json"), "mine");
    fault.beforeLink = (to) => writeFileSync(to, "theirs");
    expect(code(() => trashFile(d, "a.json"))).toBe("io_error");
    expect(readFileSync(join(d, "a.json"), "utf8")).toBe("mine");
  });

  it("falls back to an exists check plus rename where hard links are unsupported", () => {
    const d = tmp();
    writeFileSync(join(d, "a.json"), "mine");
    const at = new Date(Date.UTC(2026, 0, 2, 3, 4));
    fault.link = errno("ENOTSUP");
    const first = trashFile(d, "a.json", at);
    expect(readFileSync(join(d, first), "utf8")).toBe("mine");
    writeFileSync(join(d, "a.json"), "again");
    let raced = "";
    fault.beforeLink = (to) => {
      if (raced) return;
      raced = to;
      writeFileSync(to, "theirs");
    };
    const second = trashFile(d, "a.json", at);
    expect(second).not.toBe(first);
    expect(readFileSync(raced, "utf8")).toBe("theirs");
    expect(readFileSync(join(d, second), "utf8")).toBe("again");
  });

  it("removes the new name again when the old one cannot be unlinked", () => {
    const d = tmp();
    writeFileSync(join(d, "a.json"), "mine");
    fault.unlink = errno("EIO");
    expect(code(() => trashFile(d, "a.json"))).toBe("io_error");
    fault.unlink = null;
    expect(readdirSync(join(d, ".cadabra/trash"))).toEqual([]);
    expect(readFileSync(join(d, "a.json"), "utf8")).toBe("mine");
  });

  it("reports a missing source when hard links are unsupported", () => {
    const d = tmp();
    fault.link = errno("ENOTSUP");
    expect(() => renameNoReplace(join(d, "gone"), join(d, "b"))).toThrow(/ENOENT/);
  });

  it("ignores a directory that cannot be synced", () => {
    expect(() => syncDir(join(tmp(), "no-such-folder"))).not.toThrow();
  });
});

describe("resolveReal when even the root cannot be resolved", () => {
  it("stops at the filesystem root", () => {
    fault.realpath = errno("ENOENT");
    expect(resolveReal("/pfs-no-such-folder/child")).toBe("/pfs-no-such-folder/child");
  });
});
