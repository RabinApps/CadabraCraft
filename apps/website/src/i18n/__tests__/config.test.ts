import { describe, expect, it } from "vitest";
import { dirFor, isLocale, LOCALES, localePath, stripLocale } from "../config";
import { getMessages } from "../messages";

describe("i18n config", () => {
  it("knows its locales", () => {
    expect(isLocale("en")).toBe(true);
    expect(isLocale("xx")).toBe(false);
    expect(LOCALES).toContain("en");
  });

  it("sets text direction", () => {
    expect(dirFor("en")).toBe("ltr");
    expect(dirFor("ar")).toBe("rtl");
    expect(dirFor("he")).toBe("rtl");
  });

  it("prefixes site paths with the locale and leaves other links alone", () => {
    expect(localePath("en", "/")).toBe("/en/");
    expect(localePath("en", "/docs/writing/")).toBe("/en/docs/writing/");
    expect(localePath("en", "https://example.com/x")).toBe("https://example.com/x");
    expect(localePath("en", "//cdn.example.com/x")).toBe("//cdn.example.com/x");
    expect(localePath("en", "#top")).toBe("#top");
  });

  it("strips the locale prefix", () => {
    expect(stripLocale("/en/docs/writing/")).toBe("/docs/writing/");
    expect(stripLocale("/en")).toBe("/");
    expect(stripLocale("/docs/")).toBe("/docs/");
    expect(stripLocale("/")).toBe("/");
  });

  it("has a message catalog for every locale", () => {
    for (const l of LOCALES) expect(getMessages(l).nav.docs).toBeTruthy();
  });
});
