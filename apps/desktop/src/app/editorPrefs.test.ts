import { describe, expect, it } from "vitest";
import { cleanRawHtmlPaste } from "./editorPrefs";

describe("cleanRawHtmlPaste", () => {
  it("keeps the three choices and falls back to ask", () => {
    for (const v of ["ask", "convert", "text"] as const) expect(cleanRawHtmlPaste(v)).toBe(v);
    for (const v of [undefined, null, "", "yes", 1, {}]) expect(cleanRawHtmlPaste(v)).toBe("ask");
  });
});
