import { describe, expect, it } from "vitest";
import { LOCALES, dirFor, resolveLocale } from "./locales";

describe("dirFor", () => {
  it("marks Hebrew and Arabic (with regions and scripts) as rtl", () => {
    expect(dirFor("he")).toBe("rtl");
    expect(dirFor("ar-EG")).toBe("rtl");
    expect(dirFor("he_IL")).toBe("rtl");
  });
  it("defaults other languages to ltr", () => {
    for (const tag of ["en", "ja", "ru-RU", "fr-CA", "und"]) expect(dirFor(tag)).toBe("ltr");
  });
  it("agrees with the locale table", () => {
    for (const l of LOCALES) expect(dirFor(l.code)).toBe(l.dir);
  });
});

describe("resolveLocale", () => {
  it("falls back to English when nothing preferred is enabled", () => {
    expect(resolveLocale(["ja-JP", "he"])).toBe("en");
    expect(resolveLocale([])).toBe("en");
  });
  it("matches on the primary subtag", () => {
    expect(resolveLocale(["en-GB"])).toBe("en");
  });
});
