import { describe, expect, it } from "vitest";
import { editorFontStack } from "../editorPrefs";

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
