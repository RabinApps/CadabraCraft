// Edge cases that the other suites do not reach: odd image headers, error mapping, and failures on a real temp folder.
import { chmodSync, mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ProjectFsError,
  atomicWrite,
  backupFile,
  backupManifest,
  createProject,
  fsError,
  imageSize,
  importImage,
  readProjectFile,
  readRelativeImage,
  readSource,
  resolveReal,
  resolveSafe,
  storeImage,
  trashFile,
  writeProjectFile,
} from "../index";
import { withCopySuffix } from "../files/naming";

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 1]);
const tmp = () => mkdtempSync(join(tmpdir(), "pfs-gaps-"));
const code = (fn: () => unknown): string => {
  try {
    fn();
  } catch (e) {
    return e instanceof ProjectFsError ? e.code : `other:${String(e)}`;
  }
  return "none";
};
const posix = process.platform !== "win32";
const isRoot = posix && process.getuid?.() === 0;
const ascii = (s: string) => Array.from(s, (c) => c.charCodeAt(0));

describe("imageSize: JPEG marker walk", () => {
  const sof = (width: number, height: number) => [
    0xff,
    0xc0,
    0,
    11,
    8,
    height >> 8,
    height & 255,
    width >> 8,
    width & 255,
    3,
  ];
  const jpeg = (...parts: number[][]) => new Uint8Array([0xff, 0xd8, ...parts.flat()]);

  it("reads the frame header after fill bytes", () => {
    expect(imageSize("jpg", jpeg([0xff, 0xff], sof(20, 10)))).toEqual([20, 10]);
  });
  it("skips standalone markers (TEM, RSTn) that have no length", () => {
    expect(imageSize("jpeg", jpeg([0xff, 0x01], [0xff, 0xd0], sof(7, 5)))).toEqual([7, 5]);
  });
  it("skips segments by their length", () => {
    expect(imageSize("jpg", jpeg([0xff, 0xe0, 0, 4, 1, 1], sof(3, 2)))).toEqual([3, 2]);
  });
  it("gives up when a marker does not start with 0xFF", () => {
    expect(imageSize("jpg", jpeg([0, 0, 0, 0, 0]))).toBeNull();
  });
  it("gives up on a truncated frame header", () => {
    expect(imageSize("jpg", jpeg([0xff, 0xc0, 0, 11, 8]))).toBeNull();
  });
  it("gives up at end of image or start of scan", () => {
    expect(imageSize("jpg", jpeg([0xff, 0xd9, 0, 0]))).toBeNull();
    expect(imageSize("jpg", jpeg([0xff, 0xda, 0, 0]))).toBeNull();
  });
});

describe("imageSize: WebP variants", () => {
  const webp = (fourcc: string, length: number, fill: (b: Uint8Array) => void = () => {}) => {
    const b = new Uint8Array(length);
    b.set(ascii("RIFF"), 0);
    b.set(ascii("WEBP"), 8);
    b.set(ascii(fourcc), 12);
    fill(b);
    return b;
  };
  it("reads a lossy (VP8) header, masking the scale bits", () => {
    const b = webp("VP8 ", 30, (x) => {
      x.set([0x40, 0x01, 0xf0, 0x00], 26); // 320 x 240
    });
    expect(imageSize("webp", b)).toEqual([320, 240]);
  });
  it("gives up on a truncated lossy header", () => {
    expect(imageSize("webp", webp("VP8 ", 27))).toBeNull();
  });
  it("reads a lossless (VP8L) header", () => {
    const bits = (99 << 0) | (49 << 14); // 100 x 50
    const b = webp("VP8L", 30, (x) => {
      x.set([bits & 255, (bits >> 8) & 255, (bits >> 16) & 255, (bits >>> 24) & 255], 21);
    });
    expect(imageSize("webp", b)).toEqual([100, 50]);
  });
  it("gives up on a truncated lossless header and on an unknown chunk", () => {
    expect(imageSize("webp", webp("VP8L", 24))).toBeNull();
    expect(imageSize("webp", webp("ABCD", 40))).toBeNull();
  });
});

describe("fsError", () => {
  it("handles thrown values that are not Errors, with and without a label", () => {
    expect(fsError("boom").message).toBe("boom");
    expect(fsError("boom", "x.json").message).toBe("x.json: boom");
    expect(fsError({ code: "ENOSPC" }, "x.json").code).toBe("disk_full");
  });
});

describe("naming", () => {
  it("adds a suffix to a name without an extension, or whose only dot is in a folder", () => {
    expect(withCopySuffix("notes", 1)).toBe("notes");
    expect(withCopySuffix("notes", 2)).toBe("notes~2");
    expect(withCopySuffix("a.b/notes.json", 3)).toBe("a.b/notes~3.json");
  });
});

describe("paths", () => {
  it("refuses a chain of missing folders deeper than the link limit", () => {
    const d = tmp();
    const deep = join(d, ...Array.from({ length: 45 }, () => "a"));
    expect(code(() => resolveReal(deep))).toBe("path_escape");
  });
  it.skipIf(!posix)("rethrows an error that is not about a missing path", () => {
    expect(() => resolveReal(join(tmp(), "x".repeat(300)))).toThrow(/ENAMETOOLONG/);
  });
  it.skipIf(!posix)("follows a dangling link to a missing target", () => {
    const d = tmp();
    symlinkSync(join(d, "missing", "t"), join(d, "dangling"));
    expect(resolveReal(join(d, "dangling"))).toContain("missing");
  });
  it("resolves a path whose root is missing", () => {
    const d = tmp();
    expect(resolveSafe(d, "a/b.json")).toBe(join(d, "a", "b.json"));
  });
});

describe("images and sources", () => {
  it("refuses to store over a folder named like the image", () => {
    const d = tmp();
    mkdirSync(join(d, "assets", "x.png"), { recursive: true });
    expect(code(() => storeImage(d, "x.png", PNG))).toBe("not_a_file");
  });
  it.skipIf(!posix)("refuses a picked image path with no file name", () => {
    expect(code(() => importImage(tmp(), "/"))).toBe("unsupported_image");
  });
  it.skipIf(!posix)("names the whole path when a source has no file name", () => {
    expect(code(() => readSource("/"))).toBe("unsupported_source");
    expect(code(() => readSource("/", true))).toBe("unsupported_source");
    expect(code(() => readSource(""))).toBe("unsafe_path");
  });
  it("refuses a Markdown file whose folder is missing", () => {
    const d = tmp();
    expect(code(() => readRelativeImage(join(d, "gone", "book.md"), "a.png"))).toBe("not_found");
  });
  it.skipIf(!posix || isRoot)(
    "reports permission_denied when an image folder cannot be searched",
    () => {
      const d = tmp();
      mkdirSync(join(d, "sub"));
      writeFileSync(join(d, "sub", "a.png"), PNG);
      chmodSync(join(d, "sub"), 0o000);
      try {
        expect(code(() => readRelativeImage(join(d, "book.md"), "sub/a.png"))).toBe(
          "permission_denied",
        );
      } finally {
        chmodSync(join(d, "sub"), 0o755);
      }
    },
  );
});

describe("project files: failures on disk", () => {
  it("reports a project folder that is a file", () => {
    const d = tmp();
    writeFileSync(join(d, "book"), "x");
    expect(code(() => createProject(join(d, "book"), "{}"))).toBe("not_a_file");
  });
  it("reports a directory where a project file should be, on read and on write with a base hash", () => {
    const d = tmp();
    mkdirSync(join(d, "manuscript", "a.json"), { recursive: true });
    expect(code(() => readProjectFile(d, "manuscript/a.json"))).toBe("not_a_file");
    expect(code(() => writeProjectFile(d, "manuscript/a.json", "x", "hash"))).toBe("not_a_file");
  });
  it("cannot back up a manifest that is missing", () => {
    expect(code(() => backupManifest(tmp()))).toBe("not_found");
  });
  it("cannot back up a folder", () => {
    const d = tmp();
    mkdirSync(join(d, "manuscript", "a.json"), { recursive: true });
    expect(code(() => backupFile(d, "manuscript/a.json"))).toBe("not_a_file");
  });
  it("cannot move a file to trash when .cadabra is a file", () => {
    const d = tmp();
    writeFileSync(join(d, "a.json"), "x");
    writeFileSync(join(d, ".cadabra"), "not a folder");
    expect(code(() => trashFile(d, "a.json"))).toBe("not_a_file");
  });
});

describe("atomicWrite: folder problems", () => {
  it("reports a file where the parent folder should be", () => {
    const d = tmp();
    writeFileSync(join(d, "f"), "x");
    expect(code(() => atomicWrite(join(d, "f", "x.json"), PNG))).toBe("not_a_file");
    expect(code(() => atomicWrite(join(d, "f"), PNG))).toBe("none"); // a plain file is simply replaced
  });
  it.skipIf(!posix || isRoot)("reports permission_denied when the parent cannot be created", () => {
    const d = tmp();
    mkdirSync(join(d, "ro"));
    chmodSync(join(d, "ro"), 0o555);
    try {
      expect(code(() => atomicWrite(join(d, "ro", "sub", "x.json"), PNG))).toBe(
        "permission_denied",
      );
    } finally {
      chmodSync(join(d, "ro"), 0o755);
    }
  });
});
