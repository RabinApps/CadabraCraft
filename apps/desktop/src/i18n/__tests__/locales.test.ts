import { describe, expect, it, vi } from "vitest";
import { LOCALES, PSEUDO_LOCALE, dirFor, isLoadable, resolveLocale } from "../locales";

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
    expect(resolveLocale(["ja-JP", "ru"])).toBe("en");
    expect(resolveLocale([])).toBe("en");
  });
  it("matches on the primary subtag", () => {
    expect(resolveLocale(["en-GB"])).toBe("en");
    expect(resolveLocale(["ja-JP", "he-IL", "en"])).toBe("he");
  });
});

describe("isLoadable", () => {
  it("accepts enabled locales and the pseudo locale only in development", () => {
    expect(isLoadable("en")).toBe(true);
    expect(isLoadable("fr")).toBe(true);
    expect(isLoadable("ja")).toBe(false);
    expect(isLoadable(PSEUDO_LOCALE)).toBe(import.meta.env.DEV);
  });
  it("treats the pseudo locale as not loadable outside development", () => {
    vi.stubEnv("DEV", false);
    expect(isLoadable(PSEUDO_LOCALE)).toBe(false);
    vi.stubEnv("DEV", true);
    expect(isLoadable(PSEUDO_LOCALE)).toBe(true);
    vi.unstubAllEnvs();
  });
});
