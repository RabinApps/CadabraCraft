import { describe, expect, it } from "vitest";
import {
  BACK_MATTER_KINDS, FRONT_MATTER_KINDS, countWords, errMsg, imageMediaType, isAssetPath, isBackMatterKind, isFrontMatterKind, textDirection,
} from "./index";

describe("isAssetPath", () => {
  it("accepts one-level assets paths", () => {
    expect(isAssetPath("assets/cover.png")).toBe(true);
  });
  it("rejects nesting, traversal, backslashes and other roots", () => {
    for (const s of ["assets/a/b.png", "assets/..", "assets/a..b/", "assets\\a.png", "/assets/a.png", "manuscript/a.png", "assets/", "http://x/assets/a.png"]) {
      expect(isAssetPath(s), s).toBe(false);
    }
  });
  it("rejects names containing .. even when otherwise one level", () => {
    expect(isAssetPath("assets/a..png")).toBe(false);
  });
});

describe("imageMediaType", () => {
  it("maps allowed extensions case-insensitively", () => {
    expect(imageMediaType("assets/a.PNG")).toBe("image/png");
    expect(imageMediaType("a.jpeg")).toBe("image/jpeg");
    expect(imageMediaType("a.svg")).toBe("image/svg+xml");
  });
  it("returns null for other or missing extensions", () => {
    expect(imageMediaType("a.txt")).toBeNull();
    expect(imageMediaType("png")).toBeNull();
    expect(imageMediaType("a.png.exe")).toBeNull();
  });
});

describe("textDirection", () => {
  it("is rtl for RTL primary subtags, with region or underscore forms", () => {
    expect(textDirection("ar")).toBe("rtl");
    expect(textDirection("ar-EG")).toBe("rtl");
    expect(textDirection("HE_il")).toBe("rtl");
  });
  it("is ltr otherwise", () => {
    expect(textDirection("en-US")).toBe("ltr");
    expect(textDirection("")).toBe("ltr");
  });
});

describe("matter kind predicates", () => {
  it("accept their own kinds and reject others", () => {
    for (const k of FRONT_MATTER_KINDS) expect(isFrontMatterKind(k)).toBe(true);
    for (const k of BACK_MATTER_KINDS) expect(isBackMatterKind(k)).toBe(true);
    expect(isFrontMatterKind("colophon")).toBe(false);
    expect(isBackMatterKind("preface")).toBe(false);
    expect(isFrontMatterKind(undefined)).toBe(false);
    expect(isBackMatterKind(3)).toBe(false);
  });
  it("share only the custom kind", () => {
    expect(FRONT_MATTER_KINDS.filter((k) => (BACK_MATTER_KINDS as readonly string[]).includes(k))).toEqual(["custom"]);
  });
});

describe("errMsg", () => {
  it("reads Error messages and stringifies the rest", () => {
    expect(errMsg(new Error("boom"))).toBe("boom");
    expect(errMsg("plain")).toBe("plain");
    expect(errMsg(42)).toBe("42");
  });
});

describe("countWords", () => {
  it("ignores non-object input and malformed children", () => {
    expect(countWords(null)).toBe(0);
    expect(countWords("x")).toBe(0);
    expect(countWords({ type: "doc", content: [null, 3, { type: "paragraph", content: [{ type: "text", text: "a b" }] }] })).toBe(2);
  });
});
