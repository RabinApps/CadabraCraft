import { describe, expect, it } from "vitest";
import { strFromU8, unzipSync } from "fflate";
import type { ChapterDoc } from "@cadabracraft/shared";
import { buildEpub } from "./index";

const doc: ChapterDoc = { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "שלום עולם" }] }] };
const meta = (language: string) => ({ title: "ספר", author: "א", language, identifier: "urn:uuid:00000000-0000-4000-8000-000000000000", modified: new Date("2026-01-01T00:00:00Z") });
const parts = (language: string) => unzipSync(buildEpub(meta(language), [{ id: "ch1", title: "פרק", doc }]));
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
    const expected: Record<string, string> = { en: "Contents", ar: "المحتويات", it: "Indice", ja: "目次", ru: "Содержание", de: "Inhaltsverzeichnis", es: "Índice", "ar-EG": "المحتويات" };
    for (const [lang, heading] of Object.entries(expected)) expect(text(parts(lang), "OEBPS/nav.xhtml")).toContain(`<h1>${heading}</h1>`);
  });
  it("throws instead of falling back to English for an unsupported language", () => {
    expect(() => parts("pl")).toThrow(/no "Contents" translation for language "pl"/);
  });
});
