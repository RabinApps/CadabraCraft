import { describe, expect, it } from "vitest";
import {
  errText,
  isMissingFolder,
  isProjectError,
  noManifestMessage,
  projectErrorMessage,
  type ProjectError,
} from "../projectError";

describe("projectErrorMessage", () => {
  const cases: [ProjectError, RegExp][] = [
    [{ kind: "unsafe_path", path: "../x" }, /\.\.\/x/],
    [{ kind: "path_escape", path: "out" }, /out.*symbolic link/],
    [{ kind: "not_found", path: "a.json" }, /a\.json/],
    [{ kind: "already_exists" }, /already exists/],
    [{ kind: "not_a_project", path: "/tmp/x" }, /\/tmp\/x is not a CadabraCraft project folder/],
    [{ kind: "not_utf8", path: "a.json" }, /a\.json/],
    [{ kind: "icloud_pending", path: "a.json" }, /iCloud/],
    [{ kind: "permission_denied", path: "a.json" }, /permission.*a\.json/],
    [{ kind: "disk_full", path: "book.md" }, /no space.*book\.md/],
    [
      { kind: "image_dimensions", name: "huge.png", max_megapixels: 150 },
      /huge\.png.*150 megapixels/,
    ],
    [{ kind: "too_large", path: "big.docx", max_mb: 200 }, /big\.docx.*200 MB/],
    [{ kind: "not_a_file", path: "dir" }, /dir/],
    [{ kind: "unsupported_image", name: "a.tiff" }, /a\.tiff/],
    [{ kind: "invalid_image", name: "a.png", ext: "png" }, /a\.png.*png/],
    [{ kind: "unsupported_document", name: "a.rtf" }, /a\.rtf/],
    [{ kind: "not_image_asset", path: "x" }, /x/],
    [{ kind: "unsupported_reference", name: "setup.exe" }, /setup\.exe.*cannot be added/],
    [{ kind: "invalid_reference", name: "a.pdf", ext: "pdf" }, /a\.pdf.*pdf/],
    [{ kind: "not_reference", path: "assets/a.png" }, /assets\/a\.png/],
    [{ kind: "not_trash_path", path: "x" }, /x/],
    [{ kind: "cannot_restore", path: "x" }, /x/],
    [{ kind: "image_ref_not_allowed", reference: "/etc/p" }, /\/etc\/p/],
    [{ kind: "image_ref_not_found", reference: "i.png" }, /i\.png/],
    [{ kind: "image_ref_outside", reference: "l.png" }, /l\.png/],
    [{ kind: "invalid_file_name" }, /not valid/],
    [{ kind: "watch_failed", path: "book" }, /watch book.*outside the app/],
    [{ kind: "not_picked", name: "x.png" }, /x\.png was not chosen/],
  ];
  for (const [e, re] of cases)
    it(`describes ${e.kind}`, () => expect(projectErrorMessage(e)).toMatch(re));
  it("uses the operating system's message for io", () =>
    expect(projectErrorMessage({ kind: "io", message: "disk full" })).toBe("disk full"));
});

describe("errText", () => {
  it("maps Rust file errors", () =>
    expect(errText({ kind: "not_found", path: "a.json" })).toMatch(/a\.json/));
  it("leaves Typst errors alone (not_found there carries a message, not a path)", () =>
    expect(errText({ kind: "not_found", message: "install typst" })).toBe("install typst"));
  it("handles Errors, strings and other values as before", () => {
    expect(errText(new Error("boom"))).toBe("boom");
    expect(errText("plain")).toBe("plain");
    expect(errText(42)).toBe("42");
  });
  it("is not fooled by an Error with a kind", () => {
    expect(isProjectError(Object.assign(new Error("x"), { kind: "io" }))).toBe(false);
  });
});

describe("isProjectError", () => {
  it("accepts Rust file errors, and not_found only with a path", () => {
    expect(isProjectError({ kind: "io", message: "x" })).toBe(true);
    expect(isProjectError({ kind: "not_found", path: "a" })).toBe(true);
    expect(isProjectError({ kind: "not_found", message: "typst" })).toBe(false);
  });
  it("rejects everything else", () => {
    for (const v of [null, undefined, "io", 3, new Error("x"), {}, { kind: 1 }, { kind: "nope" }])
      expect(isProjectError(v)).toBe(false);
  });
});

describe("isMissingFolder", () => {
  it("is true for a gone folder or one without a book, false for a book that could not be read", () => {
    expect(isMissingFolder({ kind: "not_found", path: "cadabra.json" })).toBe(true);
    expect(isMissingFolder({ kind: "not_a_project", path: "/x" })).toBe(true);
    expect(isMissingFolder(new Error(noManifestMessage()))).toBe(true);
    expect(isMissingFolder({ kind: "permission_denied", path: "/x" })).toBe(false);
    expect(isMissingFolder(new Error("cadabra.json is not valid JSON"))).toBe(false);
    expect(isMissingFolder("nope")).toBe(false);
  });
});
