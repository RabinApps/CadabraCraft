import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanManuscriptFont, editorFontStack, MAX_FONT_NAME } from "../editorPrefs";

const KEY = "cadabracraft.settings";
const base = { writingWidth: "wide", typewriterScroll: true };

async function load(stored: unknown) {
  vi.resetModules();
  const data = new Map<string, string>([[KEY, JSON.stringify(stored)]]);
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => data.set(k, v),
  });
  return (await import("../editorPrefs")).useSettings.getState().manuscriptFont;
}
afterEach(() => vi.unstubAllGlobals());

describe("cleanManuscriptFont", () => {
  it("keeps the bundled choices and a plain family name", () => {
    for (const v of ["newsreader", "inter", "Lora", "EB Garamond", "Noto Serif CJK JP"])
      expect(cleanManuscriptFont(v)).toBe(v);
    expect(cleanManuscriptFont("x".repeat(MAX_FONT_NAME))).toHaveLength(MAX_FONT_NAME);
  });
  it("rejects anything that is not a usable name", () => {
    for (const v of [
      "",
      " Lora",
      "Lora ",
      "x".repeat(MAX_FONT_NAME + 1),
      "a\nb",
      "a\u0000b",
      "a\u007fb",
      "constructor",
      "__proto__",
      42,
      null,
      undefined,
      {},
      ["Lora"],
    ])
      expect(cleanManuscriptFont(v)).toBeNull();
  });
});

describe("editorFontStack", () => {
  it("maps the bundled choices to their stacks", () => {
    expect(editorFontStack("newsreader")).toBe("var(--font-book)");
    expect(editorFontStack("inter")).toBe("var(--font-ui)");
  });
  it("quotes a family and keeps the default serif behind it", () => {
    expect(editorFontStack("Lora")).toBe('"Lora", var(--font-book)');
    expect(editorFontStack('Odd "Name"\\')).toBe('"Odd \\"Name\\"\\\\", var(--font-book)');
  });
});

describe("a stored manuscript font", () => {
  it("accepts a family name", async () => {
    expect(await load({ ...base, manuscriptFont: "Lora" })).toBe("Lora");
  });
  it("falls back to the default for a bad value", async () => {
    for (const bad of ["", 7, "a\tb", "x".repeat(101), null, "toString"])
      expect(await load({ ...base, manuscriptFont: bad })).toBe("newsreader");
  });
});
