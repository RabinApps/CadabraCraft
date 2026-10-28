// Mirrors the hardening tests in apps/desktop/src-tauri/src/import_src.rs and project/mod.rs: every failure has a stable code.
import {
  chmodSync,
  closeSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  readdirSync,
  statSync,
  symlinkSync,
  truncateSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  MAX_IMAGE_BYTES,
  MAX_IMPORT_BYTES,
  ProjectFsError,
  atomicWrite,
  fsError,
  importImage,
  readAsset,
  readRelativeImage,
  readSource,
  writeBytes,
} from "../index";

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 1]);
const tmp = () => mkdtempSync(join(tmpdir(), "pfs-io-"));
const code = (fn: () => unknown): string => {
  try {
    fn();
  } catch (e) {
    return e instanceof ProjectFsError ? e.code : `other:${String(e)}`;
  }
  return "none";
};
const put = (d: string, name: string, bytes: Uint8Array | string = "x") =>
  writeFileSync(join(d, name), bytes);
const sparse = (path: string, len: number, head: Uint8Array = new Uint8Array()) => {
  const fd = openSync(path, "w");
  writeSync(fd, head);
  closeSync(fd);
  truncateSync(path, len);
};
const posix = process.platform !== "win32";
const isRoot = posix && process.getuid?.() === 0;
const bombPng = Uint8Array.from([
  ...PNG.subarray(0, 8),
  0,
  0,
  0,
  13,
  73,
  72,
  68,
  82,
  0,
  0,
  0xea,
  0x60,
  0,
  0,
  0xea,
  0x60,
  8,
  6,
  0,
  0,
  0,
]); // 60000 x 60000
const noTemp = (dir: string) =>
  expect(readdirSync(dir).filter((n) => n.endsWith(".tmp"))).toEqual([]);

describe("readSource edge cases", () => {
  it("allows ASCII case-insensitive and multi-dot names", () => {
    const d = tmp();
    for (const n of ["a.HTML", "a.Md", "a.tar.html", "a b.docx", "é.txt", "a..md"]) {
      put(d, n);
      expect(
        code(() => readSource(join(d, n))),
        n,
      ).toBe("none");
    }
  });

  it("refuses double extensions, hidden files, no extension, trailing dot or space", () => {
    const d = tmp();
    for (const n of [
      "a.html.exe",
      ".html",
      ".md",
      "noext",
      "a.",
      "a.md.",
      "a.md ",
      "a. md",
      "a.html~",
      "a.docx.zip",
    ]) {
      put(d, n);
      expect(
        code(() => readSource(join(d, n))),
        n,
      ).toBe("unsupported_source");
    }
  });

  it("refuses relative paths", () => {
    expect(code(() => readSource("book.md"))).toBe("unsafe_path");
    expect(code(() => readRelativeImage("book.md", "a.png"))).toBe("unsafe_path");
  });

  it("has typed errors for missing, iCloud placeholder and directories", () => {
    const d = tmp();
    expect(code(() => readSource(join(d, "gone.md")))).toBe("not_found");
    put(d, ".cloud.docx.icloud");
    expect(code(() => readSource(join(d, "cloud.docx")))).toBe("icloud_placeholder");
    put(d, ".cloud.png.icloud");
    expect(code(() => readRelativeImage(join(d, "book.md"), "cloud.png"))).toBe(
      "icloud_placeholder",
    );
    mkdirSync(join(d, "x.html"));
    mkdirSync(join(d, "x.png"));
    expect(code(() => readSource(join(d, "x.html")))).toBe("not_a_file");
    expect(code(() => readRelativeImage(join(d, "book.md"), "x.png"))).toBe("not_a_file");
  });

  it.skipIf(!posix || isRoot)("reports unreadable files as permission_denied", () => {
    const d = tmp();
    put(d, "a.md");
    put(d, "p.png", PNG);
    chmodSync(join(d, "a.md"), 0o000);
    chmodSync(join(d, "p.png"), 0o000);
    expect(code(() => readSource(join(d, "a.md")))).toBe("permission_denied");
    expect(code(() => readRelativeImage(join(d, "book.md"), "p.png"))).toBe("permission_denied");
  });

  it.skipIf(!posix)(
    "follows a picked link to a regular file but refuses links to folders, dangling and looping links",
    () => {
      const d = tmp();
      const [outer, picked] = [join(d, "outer"), join(d, "picked")];
      mkdirSync(outer);
      mkdirSync(picked);
      put(outer, "real.md", "outside");
      mkdirSync(join(outer, "dir"));
      symlinkSync(join(outer, "real.md"), join(picked, "link.md"));
      symlinkSync(join(outer, "dir"), join(picked, "dirlink.md"));
      symlinkSync(join(outer, "nope.md"), join(picked, "dangling.md"));
      symlinkSync(join(picked, "loop.md"), join(picked, "loop.md"));
      expect(new TextDecoder().decode(readSource(join(picked, "link.md")))).toBe("outside");
      expect(code(() => readSource(join(picked, "dirlink.md")))).toBe("not_a_file");
      expect(code(() => readSource(join(picked, "dangling.md")))).toBe("not_found");
      expect(code(() => readSource(join(picked, "loop.md")))).not.toBe("none");
    },
  );

  it.skipIf(!posix)("never opens a fifo or a device", () => {
    const d = tmp();
    execFileSync("mkfifo", [join(d, "pipe.md"), join(d, "pipe.png")]);
    expect(code(() => readSource(join(d, "pipe.md")))).toBe("not_a_file"); // would hang forever if it were opened
    expect(code(() => readRelativeImage(join(d, "book.md"), "pipe.png"))).toBe("not_a_file");
    symlinkSync("/dev/null", join(d, "null.md"));
    expect(code(() => readSource(join(d, "null.md")))).toBe("not_a_file");
  });

  it("applies the 200 MB cap at cap and cap + 1", () => {
    const d = tmp();
    const p = join(d, "cap.docx");
    sparse(p, MAX_IMPORT_BYTES);
    expect(readSource(p).length).toBe(MAX_IMPORT_BYTES);
    sparse(p, MAX_IMPORT_BYTES + 1);
    expect(code(() => readSource(p))).toBe("too_large");
  });

  it("returns text bytes untouched: empty, BOM, UTF-16, Latin-1, NUL", () => {
    const d = tmp();
    const cases: [string, number[]][] = [
      ["empty.md", []],
      ["bom.md", [0xef, 0xbb, 0xbf, 0x23, 0x20, 0x54]],
      ["utf16.txt", [0xff, 0xfe, 0x48, 0, 0x69, 0]],
      ["latin1.html", [0x63, 0x61, 0x66, 0xe9]],
      ["nul.md", [0x61, 0, 0x62]],
    ];
    for (const [n, b] of cases) {
      put(d, n, Uint8Array.from(b));
      expect(Array.from(readSource(join(d, n))), n).toEqual(b);
    }
  });
});

describe("readRelativeImage edge cases", () => {
  it("applies the 25 MB cap at cap - 1, cap and cap + 1", () => {
    const d = tmp();
    const md = join(d, "book.md");
    for (const [len, ok] of [
      [MAX_IMAGE_BYTES - 1, true],
      [MAX_IMAGE_BYTES, true],
      [MAX_IMAGE_BYTES + 1, false],
    ] as const) {
      sparse(join(d, "big.png"), len, PNG);
      if (ok) expect(readRelativeImage(md, "big.png").length).toBe(len);
      else expect(code(() => readRelativeImage(md, "big.png"))).toBe("too_large");
    }
  });

  it("checks content: empty, html body, wrong signature, utf-16 svg; allows a BOM svg", () => {
    const d = tmp();
    const md = join(d, "book.md");
    put(d, "empty.png", "");
    put(d, "html.png", "<html><body>hi</body></html>");
    put(d, "png-as.jpg", PNG);
    put(d, "ok.svg", '\ufeff<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"/>');
    put(d, "utf16.svg", Uint8Array.from([0xff, 0xfe, 0x3c, 0, 0x73, 0, 0x76, 0, 0x67, 0, 0x3e, 0]));
    put(d, "html.svg", "<html>no vector here</html>");
    for (const bad of ["empty.png", "html.png", "png-as.jpg", "utf16.svg", "html.svg"])
      expect(
        code(() => readRelativeImage(md, bad)),
        bad,
      ).toBe("bad_image");
    expect(code(() => readRelativeImage(md, "ok.svg"))).toBe("none");
  });

  it("refuses an image that declares an absurd pixel count", () => {
    const d = tmp();
    put(d, "bomb.png", bombPng);
    expect(code(() => readRelativeImage(join(d, "book.md"), "bomb.png"))).toBe("image_dimensions");
    expect(code(() => importImage(tmp(), join(d, "bomb.png")))).toBe("image_dimensions");
  });

  it("refuses reference shapes that must never reach the disk", () => {
    const md = join(tmp(), "book.md");
    for (const bad of [
      "C:/x.png",
      "C:\\x.png",
      "c:x.png",
      "//server/share/x.png",
      "\\\\server\\share\\x.png",
      "/abs.png",
      "file:///etc/x.png",
      "a/../b.png",
      "./../x.png",
      "a/./../../x.png",
      "x.png:stream",
      "\0.png",
      "a\0.png",
    ]) {
      expect(
        code(() => readRelativeImage(md, bad)),
        JSON.stringify(bad),
      ).toBe("unsafe_path");
    }
    expect(code(() => readRelativeImage(md, `${"a/".repeat(5000)}.png`))).not.toBe("none");
  });

  it("reads unicode and spaced names", () => {
    const d = tmp();
    mkdirSync(join(d, "im ages é"));
    put(join(d, "im ages é"), "picture 日本.PNG", PNG);
    const md = join(d, "book.md");
    expect(Array.from(readRelativeImage(md, "im ages é/picture 日本.PNG"))).toEqual(
      Array.from(PNG),
    );
    expect(Array.from(readRelativeImage(md, "./im ages é//picture 日本.PNG"))).toEqual(
      Array.from(PNG),
    );
    expect(code(() => readRelativeImage(md, "im ages é"))).toBe("unsupported_image");
  });
});

describe("writeBytes under exports/", () => {
  it("only writes exports/<name>", () => {
    const d = tmp();
    mkdirSync(join(d, "exports"));
    for (const bad of [
      "cadabra.json",
      "manuscript/ch1.json",
      "assets/a.png",
      "exports",
      "exports/",
      ".cadabra/x",
      "exportsx/a.pdf",
    ]) {
      expect(
        code(() => writeBytes(d, bad, new Uint8Array([1]))),
        bad,
      ).toBe("unsafe_path");
    }
    expect(code(() => writeBytes(d, "exports/../cadabra.json", new Uint8Array([1])))).not.toBe(
      "none",
    );
    expect(existsSync(join(d, "cadabra.json"))).toBe(false);
    writeBytes(d, "exports/sub/book.pdf", new Uint8Array([1, 2]));
    expect(Array.from(readFileSync(join(d, "exports/sub/book.pdf")))).toEqual([1, 2]);
  });

  it("replaces an existing export, including an empty write, and leaves no temp file", () => {
    const d = tmp();
    writeBytes(d, "exports/book.pdf", new Uint8Array([1]));
    writeBytes(d, "exports/book.pdf", new Uint8Array([1, 2, 3]));
    writeBytes(d, "exports/book.pdf", new Uint8Array());
    expect(readFileSync(join(d, "exports/book.pdf")).length).toBe(0);
    noTemp(join(d, "exports"));
  });

  it("reports a folder in the way as not_a_file and keeps it", () => {
    const d = tmp();
    mkdirSync(join(d, "exports/book.epub"), { recursive: true });
    put(join(d, "exports/book.epub"), "keep.txt");
    expect(code(() => writeBytes(d, "exports/book.epub", new Uint8Array([1])))).toBe("not_a_file");
    expect(existsSync(join(d, "exports/book.epub/keep.txt"))).toBe(true);
    noTemp(join(d, "exports"));
  });

  it("reports exports being a file as not_a_file", () => {
    const d = tmp();
    put(d, "exports", "i am a file");
    expect(code(() => writeBytes(d, "exports/book.epub", new Uint8Array([1])))).toBe("not_a_file");
    expect(readFileSync(join(d, "exports"), "utf8")).toBe("i am a file");
  });

  it.skipIf(!posix || isRoot)(
    "reports a read-only folder as permission_denied and leaves nothing",
    () => {
      const d = tmp();
      const exports = join(d, "exports");
      mkdirSync(exports);
      chmodSync(exports, 0o555);
      const result = code(() => writeBytes(d, "exports/book.epub", new Uint8Array([1])));
      chmodSync(exports, 0o755);
      expect(result).toBe("permission_denied");
      expect(readdirSync(exports)).toEqual([]);
    },
  );

  it.skipIf(!posix)("replaces a read-only file and keeps its mode", () => {
    const d = tmp();
    writeBytes(d, "exports/book.pdf", new Uint8Array([1]));
    chmodSync(join(d, "exports/book.pdf"), 0o444);
    writeBytes(d, "exports/book.pdf", new Uint8Array([2]));
    expect(Array.from(readFileSync(join(d, "exports/book.pdf")))).toEqual([2]);
    expect(statSync(join(d, "exports/book.pdf")).mode & 0o777).toBe(0o444);
    noTemp(join(d, "exports"));
  });

  it.skipIf(!posix)("never follows a link out of exports/", () => {
    const d = tmp();
    const [proj, outside] = [join(d, "p"), join(d, "outside")];
    mkdirSync(join(proj, "exports"), { recursive: true });
    mkdirSync(outside);
    symlinkSync(join(outside, "victim.pdf"), join(proj, "exports/book.pdf")); // dangling
    put(outside, "real.pdf", "keep");
    symlinkSync(join(outside, "real.pdf"), join(proj, "exports/book.epub"));
    expect(code(() => writeBytes(proj, "exports/book.pdf", new Uint8Array([1])))).toBe(
      "path_escape",
    );
    expect(code(() => writeBytes(proj, "exports/book.epub", new Uint8Array([1])))).toBe(
      "path_escape",
    );
    expect(existsSync(join(outside, "victim.pdf"))).toBe(false);
    expect(readFileSync(join(outside, "real.pdf"), "utf8")).toBe("keep");
  });

  it("uses unique temp names and never touches a foreign temp file", () => {
    const d = tmp();
    put(d, ".a.json.tmp", "someone else's");
    atomicWrite(join(d, "a.json"), new Uint8Array([49]));
    expect(readFileSync(join(d, ".a.json.tmp"), "utf8")).toBe("someone else's");
    expect(readFileSync(join(d, "a.json"), "utf8")).toBe("1");
  });

  it("maps errno values to the same codes as the Rust layer", () => {
    const e = (c: string) => Object.assign(new Error(c), { code: c });
    const m = (c: string) => fsError(e(c)).code;
    expect([
      m("ENOENT"),
      m("EACCES"),
      m("EPERM"),
      m("EROFS"),
      m("ENOSPC"),
      m("EDQUOT"),
      m("EISDIR"),
      m("ENOTDIR"),
      m("EIO"),
    ]).toEqual([
      "not_found",
      "permission_denied",
      "permission_denied",
      "permission_denied",
      "disk_full",
      "disk_full",
      "not_a_file",
      "not_a_file",
      "io_error",
    ]);
  });

  it("serves assets through the same capped reader", () => {
    const d = tmp();
    mkdirSync(join(d, "assets"));
    expect(code(() => readAsset(d, "assets/gone.png"))).toBe("not_found");
    sparse(join(d, "assets/big.png"), MAX_IMAGE_BYTES + 1, PNG);
    expect(code(() => readAsset(d, "assets/big.png"))).toBe("too_large");
  });
});
