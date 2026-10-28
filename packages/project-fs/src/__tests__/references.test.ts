import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  symlinkSync,
  truncateSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  BLOCKED_REFERENCE_EXTENSIONS,
  ProjectFsError,
  importReference,
  maxReferenceBytes,
  referenceKind,
} from "../index";

const MB = 1024 * 1024;
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 1]);
const tmp = () => mkdtempSync(join(tmpdir(), "pfs-ref-"));
const src = (d: string, name: string, bytes: Uint8Array | string) => {
  const p = join(d, name);
  writeFileSync(p, bytes);
  return p;
};
const ascii = (s: string) => Uint8Array.from(s, (c) => c.charCodeAt(0));
const pad = (b: Uint8Array, n = 32) => {
  const out = new Uint8Array(Math.max(n, b.length));
  out.set(b);
  return out;
};
const mp4 = () => pad(ascii("\0\0\0\x18ftypmp42"), 40);
const fail = (fn: () => unknown): ProjectFsError => {
  try {
    fn();
  } catch (e) {
    if (e instanceof ProjectFsError) return e;
    throw e;
  }
  throw new Error("did not fail");
};
const listing = (root: string) => readdirSync(join(root, "references")).sort();

afterEach(() => vi.restoreAllMocks());

describe("kinds and caps", () => {
  it("maps extensions to kinds and kinds to caps", () => {
    expect(
      ["png", "mov", "flac", "pdf", "md", "xlsx", "", "constructor"].map(referenceKind),
    ).toEqual(["image", "video", "audio", "pdf", "text", "other", "other", "other"]);
    expect(
      (["video", "audio", "pdf", "image", "other", "text"] as const).map(
        (k) => maxReferenceBytes(k) / MB,
      ),
    ).toEqual([500, 200, 200, 100, 100, 5]);
    expect(BLOCKED_REFERENCE_EXTENSIONS).toHaveLength(32);
  });
});

describe("importReference", () => {
  it("copies a file into references/ with a sanitised name and a starting title", () => {
    const root = tmp();
    const d = tmp();
    const r = importReference(root, src(d, "Moodboard #1 (final).PNG", PNG));
    expect(r).toEqual({
      file: "references/Moodboard-1-final.png",
      title: "Moodboard #1 (final)",
      size: PNG.length,
      kind: "image",
      reused: false,
    });
    expect(readFileSync(join(root, r.file))).toEqual(Buffer.from(PNG));
    expect(listing(root)).toEqual(["Moodboard-1-final.png"]);
  });

  it("reuses identical content, suffixes different content and never overwrites", () => {
    const root = tmp();
    const d = tmp();
    const a = importReference(root, src(d, "a.png", PNG));
    expect(importReference(root, src(d, "a.png", PNG))).toMatchObject({
      file: a.file,
      reused: true,
    });
    const other = pad(PNG, 20);
    expect(importReference(root, src(d, "a.png", other))).toMatchObject({
      file: "references/a-2.png",
      reused: false,
    });
    expect(importReference(root, src(d, "a.png", other))).toMatchObject({
      file: "references/a-2.png",
      reused: true,
    });
    // Same size, different bytes: the hash decides.
    const same = Uint8Array.from(other);
    same[15] = 9;
    expect(importReference(root, src(d, "a.png", same))).toMatchObject({
      file: "references/a-3.png",
      reused: false,
    });
    expect(listing(root)).toEqual(["a-2.png", "a-3.png", "a.png"]);
    expect(readFileSync(join(root, "references/a.png"))).toEqual(Buffer.from(PNG));
  });

  it("steps over a folder that has the wanted name", () => {
    const root = tmp();
    mkdirSync(join(root, "references/a.png"), { recursive: true });
    const r = importReference(root, src(tmp(), "a.png", PNG));
    expect(r.file).toBe("references/a-2.png");
  });

  it("handles names with no extension, no usable stem and a dotfile", () => {
    const root = tmp();
    const d = tmp();
    expect(importReference(root, src(d, "README", "hello"))).toMatchObject({
      file: "references/README",
      kind: "other",
      title: "README",
    });
    expect(importReference(root, src(d, "日本語.txt", "hello"))).toMatchObject({
      file: "references/file.txt",
      title: "日本語",
      kind: "text",
    });
    expect(importReference(root, src(d, ".notes", "x"))).toMatchObject({
      file: "references/file.notes",
      title: "file",
    });
  });

  it("truncates long stems like assets", () => {
    const root = tmp();
    const r = importReference(root, src(tmp(), `${"x".repeat(120)}.txt`, "t"));
    expect(r.file).toBe(`references/${"x".repeat(80)}.txt`);
  });

  it("accepts each kind with its signature", () => {
    const root = tmp();
    const d = tmp();
    const files: [string, Uint8Array | string, string][] = [
      ["a.svg", '<svg xmlns="http://www.w3.org/2000/svg"/>', "image"],
      ["a.pdf", "junk\n%PDF-1.7\n", "pdf"],
      ["a.mp4", mp4(), "video"],
      ["b.mov", mp4(), "video"],
      ["a.webm", pad(Uint8Array.of(0x1a, 0x45, 0xdf, 0xa3)), "video"],
      ["a.mp3", pad(ascii("ID3")), "audio"],
      ["b.mp3", pad(Uint8Array.of(0xff, 0xfb, 0x90)), "audio"],
      ["a.wav", pad(ascii("RIFF\0\0\0\0WAVEfmt ")), "audio"],
      ["a.ogg", pad(ascii("OggS")), "audio"],
      ["a.oga", pad(ascii("OggS")), "audio"],
      ["a.flac", pad(ascii("fLaC")), "audio"],
      ["a.m4a", mp4(), "audio"],
      ["a.m4v", mp4(), "video"],
      ["a.md", "# hi\n", "text"],
      ["a.xlsx", "PK anything", "other"],
    ];
    for (const [name, bytes, kind] of files)
      expect(importReference(root, src(d, name, bytes)).kind, name).toBe(kind);
  });

  it("refuses content that does not match its extension", () => {
    const root = tmp();
    const d = tmp();
    const bad: [string, Uint8Array | string][] = [
      ["a.png", "not a png"],
      ["a.svg", "<html>"],
      ["a.pdf", "x".repeat(2000) + "%PDF-"],
      ["a.mp4", ascii("short")],
      ["a.mp4", pad(ascii("\0\0\0\0nope"), 40)],
      ["a.webm", pad(ascii("nope"))],
      ["a.mp3", pad(ascii("nope"))],
      ["a.mp3", ascii("\xff")],
      ["a.wav", pad(ascii("RIFF\0\0\0\0AVI "))],
      ["a.ogg", pad(ascii("nope"))],
      ["a.flac", pad(ascii("nope"))],
      ["a.txt", Uint8Array.of(0xff, 0xfe, 0xfd)],
      ["a.txt", "has\0nul"],
    ];
    for (const [name, bytes] of bad) {
      const e = fail(() => importReference(root, src(d, name, bytes)));
      expect(e.code, name).toBe("bad_reference");
      expect(e.message).toContain(name);
    }
    expect(listing(root)).toEqual([]); // no temp file is left behind
  });

  it("keeps the pixel limit error of images and flags oversized dimensions", () => {
    const root = tmp();
    const png = new Uint8Array(33);
    png.set(PNG.subarray(0, 8));
    png.set(ascii("IHDR"), 12);
    new DataView(png.buffer).setUint32(16, 20000);
    new DataView(png.buffer).setUint32(20, 20000);
    expect(fail(() => importReference(root, src(tmp(), "big.png", png))).code).toBe(
      "image_dimensions",
    );
  });

  it("refuses blocked and malformed extensions", () => {
    const root = tmp();
    const d = tmp();
    for (const n of ["run.EXE", "a.sh", "page.html", "x.js", "a.svg.app"])
      expect(fail(() => importReference(root, src(d, n, "x"))).code, n).toBe(
        "unsupported_reference",
      );
    for (const n of ["a.p-g", "a.waytoolongext", "a."])
      expect(fail(() => importReference(root, src(d, n, "x"))).code, n).toBe(
        "unsupported_reference",
      );
    expect(fail(() => importReference(root, "/")).code).toBe("unsupported_reference");
    expect(existsSync(join(root, "references"))).toBe(false);
  });

  it("enforces the per-kind size cap before copying", () => {
    const root = tmp();
    const d = tmp();
    const big = (name: string, mb: number) => {
      const p = src(d, name, "");
      truncateSync(p, mb * MB + 1);
      return p;
    };
    expect(fail(() => importReference(root, big("a.txt", 5))).message).toBe(
      "a.txt is larger than 5 MB",
    );
    expect(fail(() => importReference(root, big("a.png", 100))).code).toBe("too_large");
    expect(fail(() => importReference(root, big("a.pdf", 200))).message).toContain("200 MB");
    expect(fail(() => importReference(root, big("a.mp4", 500))).message).toContain("500 MB");
    expect(existsSync(join(root, "references"))).toBe(false);
  });

  it("reports a missing source, a folder and an unreadable file", () => {
    const root = tmp();
    const d = tmp();
    expect(fail(() => importReference(root, join(d, "nope.png"))).code).toBe("not_found");
    mkdirSync(join(d, "dir.png"));
    expect(fail(() => importReference(root, join(d, "dir.png"))).code).toBe("not_a_file");
    const locked = src(d, "locked.png", PNG);
    chmodSync(locked, 0o000);
    if (process.getuid?.() !== 0)
      expect(fail(() => importReference(root, locked)).code).toBe("permission_denied");
    chmodSync(locked, 0o644);
    expect(existsSync(join(root, "references")) ? listing(root) : []).toEqual([]);
  });

  it("follows a link to a file and refuses references/ being a file", () => {
    const root = tmp();
    const d = tmp();
    const target = src(d, "t.png", PNG);
    symlinkSync(target, join(d, "link.png"));
    expect(importReference(root, join(d, "link.png")).file).toBe("references/link.png");
    const other = tmp();
    writeFileSync(join(other, "references"), "file");
    expect(fail(() => importReference(other, target)).code).toBe("not_a_file");
  });

  it("reports a project folder it cannot write to", () => {
    const root = tmp();
    chmodSync(root, 0o555);
    try {
      if (process.getuid?.() !== 0)
        expect(fail(() => importReference(root, src(tmp(), "a.png", PNG))).code).toBe(
          "permission_denied",
        );
    } finally {
      chmodSync(root, 0o755);
    }
  });

  it("refuses a references/ link that leaves the project", () => {
    const root = tmp();
    symlinkSync(tmp(), join(root, "references"));
    expect(fail(() => importReference(root, src(tmp(), "a.png", PNG))).code).toBe("path_escape");
  });
});
