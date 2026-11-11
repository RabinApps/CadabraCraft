import { describe, expect, it } from "vitest";
import {
  BACK_MATTER_KINDS,
  FRONT_MATTER_KINDS,
  SINGLE_USE_KINDS,
  countWords,
  errMsg,
  imageMediaType,
  isAssetPath,
  isBackMatterKind,
  isFrontMatterKind,
  isLangTag,
  langAndRegion,
  textDirection,
  wordStarts,
} from "../index";

describe("isAssetPath", () => {
  it("accepts one-level assets paths", () => {
    expect(isAssetPath("assets/cover.png")).toBe(true);
  });
  it("rejects nesting, traversal, backslashes and other roots", () => {
    for (const s of [
      "assets/a/b.png",
      "assets/..",
      "assets/a..b/",
      "assets\\a.png",
      "/assets/a.png",
      "manuscript/a.png",
      "assets/",
      "http://x/assets/a.png",
    ]) {
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
  it("has a front-only, single-use contents kind", () => {
    expect(isFrontMatterKind("contents")).toBe(true);
    expect(isBackMatterKind("contents")).toBe(false);
    expect(SINGLE_USE_KINDS).toEqual(["title-page", "copyright", "contents", "index", "glossary"]);
  });
  it("has back-only, single-use index and glossary kinds", () => {
    for (const k of ["index", "glossary"] as const) {
      expect(isBackMatterKind(k)).toBe(true);
      expect(isFrontMatterKind(k)).toBe(false);
    }
  });
  it("share only the custom kind", () => {
    expect(
      FRONT_MATTER_KINDS.filter((k) => (BACK_MATTER_KINDS as readonly string[]).includes(k)),
    ).toEqual(["custom", "blank"]);
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
  it("keeps words with a curly apostrophe or dash whole", () => {
    const doc = (t: string) => ({
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: t }] }],
    });
    expect(countWords(doc("don’t ’tis rock’n’roll “Hi,” she said—twice"))).toBe(6);
    expect(countWords(doc("“Hello,” … ‘yes’ – no"))).toBe(5);
  });
  it("ignores non-object input and malformed children", () => {
    expect(countWords(null)).toBe(0);
    expect(countWords("x")).toBe(0);
    expect(
      countWords({
        type: "doc",
        content: [null, 3, { type: "paragraph", content: [{ type: "text", text: "a b" }] }],
      }),
    ).toBe(2);
  });
});

describe("wordStarts", () => {
  it("finds the first character after spaces, tabs, leaves and the start", () => {
    expect(wordStarts(["  Hello big\tworld "])).toEqual([2, 8, 12]);
    expect(wordStarts(["ab", "cd ef"])).toEqual([0, 5]);
    expect(wordStarts(["one", null, "two"])).toEqual([0, 4]);
    expect(wordStarts(["a b\nc"])).toEqual([0]);
    expect(wordStarts([])).toEqual([]);
    expect(wordStarts(["   "])).toEqual([]);
    // A footnote of n positions is part of no word: it takes room but starts nothing and ends nothing.
    expect(wordStarts(["one", 5, "two three"])).toEqual([0, 12]);
    expect(wordStarts(["one ", 4, " two"])).toEqual([0, 9]);
  });
});

describe("language tags", () => {
  it("accepts letters, digits and single hyphens up to 35 characters", () => {
    for (const t of ["fr", "fr-CA", "zh-Hans-CN", "es-419", "a".repeat(35)])
      expect(isLangTag(t)).toBe(true);
  });
  it("rejects everything else", () => {
    for (const t of [
      "",
      "fr_CA",
      "-fr",
      "fr-",
      "fr--CA",
      "fr CA",
      'fr"',
      "a".repeat(36),
      5,
      null,
      undefined,
    ])
      expect(isLangTag(t)).toBe(false);
  });
  it("splits a tag into language and region the way Typst takes them", () => {
    expect(langAndRegion("FR")).toEqual({ lang: "fr" });
    expect(langAndRegion("fr-ca")).toEqual({ lang: "fr", region: "CA" });
    expect(langAndRegion("zh-Hans-CN")).toEqual({ lang: "zh" });
    expect(langAndRegion("x-klingon")).toBeNull();
    expect(langAndRegion("")).toBeNull();
  });
});
