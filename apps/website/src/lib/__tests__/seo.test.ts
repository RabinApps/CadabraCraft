import { describe, expect, it } from "vitest";
import { breadcrumbLd, languageAlternates, pageMetadata } from "../seo";

describe("seo", () => {
  it("emits a hreflang entry per locale plus x-default", () => {
    expect(languageAlternates("/docs/")).toEqual({ en: "/en/docs/", "x-default": "/en/docs/" });
  });

  it("builds locale-aware metadata", () => {
    const m = pageMetadata("en", "T", "D", "/features/");
    expect(m.alternates?.canonical).toBe("/en/features/");
    expect(m.alternates?.languages).toHaveProperty("x-default");
    expect(m.openGraph).toMatchObject({ url: "https://cadabracraft.com/en/features/", locale: "en" });
  });

  it("keeps noindex pages out of search", () => {
    expect(pageMetadata("en", "T", "D", "/x/", { noindex: true }).robots).toEqual({ index: false, follow: true });
  });

  it("builds a localized breadcrumb", () => {
    const ld = breadcrumbLd("en", [["Docs", "/docs/"]]);
    expect(ld.itemListElement[0]?.item).toBe("https://cadabracraft.com/en/docs/");
  });
});
