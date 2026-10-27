import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync, truncateSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { MAX_IMAGE_BYTES, MAX_IMPORT_BYTES, ProjectFsError, importImage, readAsset, readRelativeImage, readSource, storeImage, writeProjectFile } from "../src/index";

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 1]);
const tmp = () => mkdtempSync(join(tmpdir(), "pfs-a-"));
const msg = (fn: () => unknown): string => {
  try {
    fn();
  } catch (e) {
    return e instanceof ProjectFsError ? `${e.code}: ${e.message}` : `other:${String(e)}`;
  }
  return "none";
};
const src = (d: string, name: string, bytes: Uint8Array | string) => {
  const p = join(d, name);
  writeFileSync(p, bytes);
  return p;
};

describe("importImage", () => {
  it("copies into assets/, sanitizes the name and leaves the source alone", () => {
    const [proj, out] = [tmp(), tmp()];
    const s = src(out, "My Cover (final)!.PNG", PNG);
    const rel = importImage(proj, s);
    expect(rel).toBe("assets/My-Cover-final.png");
    expect(new Uint8Array(readFileSync(join(proj, rel)))).toEqual(PNG);
    expect(existsSync(s)).toBe(true);
  });
  it("reuses identical content and suffixes different content", () => {
    const [proj, out] = [tmp(), tmp()];
    const a = src(out, "a.png", PNG);
    expect(importImage(proj, a)).toBe("assets/a.png");
    expect(importImage(proj, a)).toBe("assets/a.png");
    mkdirSync(join(out, "sub"));
    const other = src(join(out, "sub"), "a.png", new Uint8Array([...PNG, 9]));
    expect(importImage(proj, other)).toBe("assets/a-2.png");
    expect(new Uint8Array(readFileSync(join(proj, "assets/a.png")))).toEqual(PNG);
  });
  it("rejects bad extension, content, size and non-files, writing nothing", () => {
    const [proj, out] = [tmp(), tmp()];
    expect(msg(() => importImage(proj, src(out, "x.exe", PNG)))).toContain("unsupported");
    expect(msg(() => importImage(proj, src(out, "noext", PNG)))).toContain("unsupported");
    expect(msg(() => importImage(proj, src(out, "fake.png", "not an image")))).toContain("not a valid");
    expect(msg(() => importImage(proj, join(out, "missing.png")))).toContain("not_found");
    mkdirSync(join(out, "d.png"));
    expect(msg(() => importImage(proj, join(out, "d.png")))).toContain("not a file");
    const big = join(out, "big.png");
    writeFileSync(big, "");
    truncateSync(big, MAX_IMAGE_BYTES + 1);
    expect(msg(() => importImage(proj, big))).toContain("larger than 25 MB");
    expect(existsSync(join(proj, "assets"))).toBe(false);
  });
  it("rejects oversize bytes in storeImage", () => {
    expect(msg(() => storeImage(tmp(), "big.png", new Uint8Array(MAX_IMAGE_BYTES + 1)))).toContain("larger");
  });
  it("accepts every allowed type", () => {
    const proj = tmp();
    const enc = new TextEncoder();
    const cases: [string, Uint8Array][] = [
      ["a.png", PNG],
      ["b.jpg", new Uint8Array([0xff, 0xd8, 0xff, 0xe0])],
      ["c.jpeg", new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1])],
      ["d.gif", enc.encode("GIF89a..")],
      ["e.webp", enc.encode("RIFF\0\0\0\0WEBPVP8 ")],
      ["f.svg", enc.encode('<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"/>')],
    ];
    for (const [n, b] of cases) expect(storeImage(proj, n, b)).toBe(`assets/${n}`);
  });
});

describe("readAsset", () => {
  it("serves only images under assets/", () => {
    const proj = tmp();
    const rel = storeImage(proj, "a.png", PNG);
    expect(new Uint8Array(readAsset(proj, rel))).toEqual(PNG);
    writeProjectFile(proj, "manuscript/x.json", "{}");
    for (const bad of ["manuscript/x.json", "assets/../cadabra.json", "assets/notes.txt", "../a.png", "/etc/a.png", "assets/missing.png"]) {
      expect(msg(() => readAsset(proj, bad)), bad).not.toBe("none");
    }
  });
});

describe("readSource", () => {
  it("reads allowed sources and adds nothing next to them", () => {
    const d = tmp();
    for (const n of ["a.docx", "b.MD", "c.markdown", "d.txt", "e.html", "f.HTM"]) {
      writeFileSync(join(d, n), "x");
      expect(new TextDecoder().decode(readSource(join(d, n))), n).toBe("x");
    }
    expect(readFileSync(join(d, "a.docx"), "utf8")).toBe("x");
  });
  it("refuses bad extension, directory, missing and oversize", () => {
    const d = tmp();
    writeFileSync(join(d, "a.exe"), "x");
    mkdirSync(join(d, "dir.md"));
    expect(msg(() => readSource(join(d, "a.exe")))).toContain("not a .docx");
    expect(msg(() => readSource(join(d, "dir.md")))).toContain("not a file");
    expect(msg(() => readSource(join(d, "missing.md")))).not.toBe("none");
    const big = join(d, "big.docx");
    writeFileSync(big, "");
    truncateSync(big, MAX_IMPORT_BYTES + 1);
    expect(msg(() => readSource(big))).toContain("larger than 200 MB");
  });
});

describe("readRelativeImage", () => {
  it("reads relative images, with or without ./", () => {
    const d = tmp();
    mkdirSync(join(d, "img"));
    writeFileSync(join(d, "img/a.png"), PNG);
    const md = join(d, "book.md");
    expect(new Uint8Array(readRelativeImage(md, "img/a.png"))).toEqual(PNG);
    expect(new Uint8Array(readRelativeImage(md, "./img/a.png"))).toEqual(PNG);
  });
  it("rejects escapes, non-images, fakes and missing files", () => {
    const outer = tmp();
    mkdirSync(join(outer, "sub"));
    writeFileSync(join(outer, "secret.png"), PNG);
    writeFileSync(join(outer, "sub/notes.txt"), "hi");
    writeFileSync(join(outer, "sub/fake.png"), "not an image");
    const md = join(outer, "sub/book.md");
    for (const bad of ["../secret.png", "a/../../secret.png", join(outer, "secret.png"), "", "..\\secret.png", "notes.txt", "fake.png", "missing.png", "sub"]) {
      expect(msg(() => readRelativeImage(md, bad)), bad).not.toBe("none");
    }
  });
  it("rejects symlink escapes and allows symlinks that stay inside", () => {
    const outer = tmp();
    mkdirSync(join(outer, "sub"));
    writeFileSync(join(outer, "secret.png"), PNG);
    writeFileSync(join(outer, "sub/real.png"), PNG);
    symlinkSync(join(outer, "secret.png"), join(outer, "sub/link.png"));
    symlinkSync(outer, join(outer, "sub/up"));
    symlinkSync(join(outer, "sub/real.png"), join(outer, "sub/inner.png"));
    const md = join(outer, "sub/book.md");
    expect(msg(() => readRelativeImage(md, "link.png"))).toContain("outside");
    expect(msg(() => readRelativeImage(md, "up/secret.png"))).toContain("outside");
    expect(new Uint8Array(readRelativeImage(md, "inner.png"))).toEqual(PNG);
  });
});
