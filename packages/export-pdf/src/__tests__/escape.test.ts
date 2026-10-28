import { describe, expect, it } from "vitest";
import { escapeMarkup, typstString } from "../escape";
import { HOSTILE } from "./hostile";

/** Remove escape pairs; whatever is left must contain no active markup characters. */
const stripEscapes = (s: string): string => s.replace(/\\[\s\S]/g, "");

describe("escapeMarkup", () => {
  it("escapes every markup special character", () => {
    for (const c of ["\\", "#", "$", "*", "_", "`", "<", ">", "@", "~", "[", "]", '"', "'"]) {
      expect(escapeMarkup(`a${c}b`)).toBe(`a\\${c}b`);
    }
  });

  it("leaves no active special characters for hostile input", () => {
    for (const h of HOSTILE) {
      const left = stripEscapes(escapeMarkup(h, { lineStart: true }));
      expect(left, h).not.toMatch(/[#$*_`<>@~[\]"'\\]/);
      expect(left, h).not.toMatch(/\/[/*]/);
    }
  });

  it("escapes comment openers", () => {
    expect(escapeMarkup("a // b")).toBe("a \\// b");
    expect(escapeMarkup("a /* b")).toBe("a \\/\\* b");
    expect(escapeMarkup("a / b")).toBe("a / b");
  });

  it("escapes heading and list markers only at line start", () => {
    expect(escapeMarkup("= x", { lineStart: true })).toBe("\\= x");
    expect(escapeMarkup("- x", { lineStart: true })).toBe("\\- x");
    expect(escapeMarkup("+ x", { lineStart: true })).toBe("\\+ x");
    expect(escapeMarkup("/ x", { lineStart: true })).toBe("\\/ x");
    expect(escapeMarkup("1. x", { lineStart: true })).toBe("1\\. x");
    expect(escapeMarkup("  - x", { lineStart: true })).toBe("  \\- x");
    expect(escapeMarkup("a = b - c + d")).toBe("a = b - c + d");
    expect(escapeMarkup("3.5 miles", { lineStart: true })).toBe("3\\.5 miles");
    expect(escapeMarkup("1984", { lineStart: true })).toBe("1984");
  });

  it("escapes markers after an embedded newline", () => {
    expect(escapeMarkup("a\n- b")).toBe("a\\\n\\- b");
  });

  it("escapes dash and ellipsis shorthand", () => {
    expect(escapeMarkup("a--b")).toBe("a\\-\\-b");
    expect(escapeMarkup("a---b")).toBe("a\\-\\-\\-b");
    expect(escapeMarkup("a-?b")).toBe("a\\-?b");
    expect(escapeMarkup("wait...")).toBe("wait\\...");
    expect(escapeMarkup("a-b")).toBe("a-b");
  });

  it("protects text following a function call", () => {
    expect(escapeMarkup(".x (y)", { afterCall: true })).toBe("\\.x (y)");
    expect(escapeMarkup("(y)", { afterCall: true })).toBe("\\(y)");
    expect(escapeMarkup(" .x", { afterCall: true })).toBe(" .x");
  });

  it("normalises line separators and drops control characters", () => {
    expect(escapeMarkup("a\r\nb\u2028c")).toBe("a\\\nb\\\nc");
    expect(escapeMarkup("a\u0000b\u0007c")).toBe("abc");
  });

  it("keeps non-ASCII text untouched", () => {
    expect(escapeMarkup("Zoë — 日本語 שלום")).toBe("Zoë — 日本語 שלום");
  });
});

describe("typstString", () => {
  it("escapes quotes, backslashes and newlines", () => {
    expect(typstString('a"b\\c\nd')).toBe('"a\\"b\\\\c\\nd"');
    expect(typstString("#[x] $")).toBe('"#[x] $"');
  });
});
