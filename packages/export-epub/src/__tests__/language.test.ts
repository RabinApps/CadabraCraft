import { describe, expect, it } from "vitest";
import { strFromU8, unzipSync } from "fflate";
import type { ChapterDoc } from "@cadabracraft/shared";
import { accessibilityMetadata, buildEpub } from "../index";

const doc: ChapterDoc = {
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text: "שלום עולם" }] }],
};
const meta = (language: string) => ({
  title: "ספר",
  author: "א",
  language,
  identifier: "urn:uuid:00000000-0000-4000-8000-000000000000",
  modified: new Date("2026-01-01T00:00:00Z"),
});
const parts = (language: string) =>
  unzipSync(buildEpub(meta(language), [{ id: "ch1", title: "פרק", doc }]));
const text = (f: ReturnType<typeof parts>, p: string) => strFromU8(f[p]!);

describe("buildEpub languages", () => {
  it("marks right-to-left books in the pages and the spine", () => {
    const f = parts("he");
    expect(text(f, "OEBPS/ch1.xhtml")).toContain('lang="he" xml:lang="he" dir="rtl"');
    expect(text(f, "OEBPS/content.opf")).toContain('<spine page-progression-direction="rtl">');
    expect(text(f, "OEBPS/nav.xhtml")).toContain("<h1>תוכן העניינים</h1>");
  });
  it("leaves left-to-right books without direction attributes", () => {
    const f = parts("fr");
    expect(text(f, "OEBPS/ch1.xhtml")).not.toContain("dir=");
    expect(text(f, "OEBPS/content.opf")).toContain("<spine>");
    expect(text(f, "OEBPS/nav.xhtml")).toContain("<h1>Table des matières</h1>");
  });
  it("localizes the contents heading for every supported language and ignores the region", () => {
    const expected: Record<string, string> = {
      en: "Contents",
      ar: "المحتويات",
      it: "Indice",
      ja: "目次",
      ru: "Содержание",
      de: "Inhaltsverzeichnis",
      es: "Índice",
      "ar-EG": "المحتويات",
    };
    for (const [lang, heading] of Object.entries(expected))
      expect(text(parts(lang), "OEBPS/nav.xhtml")).toContain(`<h1>${heading}</h1>`);
  });
  it("throws instead of falling back to English for an unsupported language", () => {
    expect(() => parts("pl")).toThrow(/no "Contents" translation for language "pl"/);
  });
  it("writes the accessibility summary in the book's language for every supported language", () => {
    const expected: Record<string, string> = {
      en: "This publication is reflowable text",
      he: "פרסום זה הוא טקסט זורם",
      ar: "هذا المنشور نص قابل",
      it: "Questa pubblicazione è un testo",
      ja: "この出版物はリフロー型",
      ru: "Это издание представляет собой",
      fr: "Cette publication est un texte",
      de: "Diese Publikation ist ein",
      es: "Esta publicación es un texto",
      "fr-CA": "Cette publication est un texte",
    };
    for (const [lang, start] of Object.entries(expected)) {
      const opf = text(parts(lang), "OEBPS/content.opf");
      const primary = lang.split("-")[0];
      expect(opf, lang).toContain(
        `<meta property="schema:accessibilitySummary" xml:lang="${primary}">${start}`,
      );
    }
  });
  it("has a distinct summary sentence for each image situation in every language", () => {
    const facts = { images: 0, imagesMissingAlt: 0, hasCover: false, hasGif: false, hasSvg: false };
    const summary = (lang: string, f: Partial<typeof facts>) =>
      /accessibilitySummary"[^>]*>([^<]*)</.exec(
        accessibilityMetadata({ ...facts, ...f }, lang),
      )![1];
    for (const lang of ["en", "he", "ar", "it", "ja", "ru", "fr", "de", "es"]) {
      const none = summary(lang, {});
      const all = summary(lang, { images: 2 });
      const some = summary(lang, { images: 2, imagesMissingAlt: 1 });
      expect(new Set([none, all, some]).size, lang).toBe(3);
    }
    expect(summary("fr", { images: 1, imagesMissingAlt: 1 })).toContain(
      "n'ont pas de texte alternatif",
    );
  });
  it("throws for the accessibility summary of an unsupported language", () => {
    expect(() =>
      accessibilityMetadata(
        { images: 0, imagesMissingAlt: 0, hasCover: false, hasGif: false, hasSvg: false },
        "pl",
      ),
    ).toThrow(/no "Accessibility summary" translation for language "pl"/);
  });
});
