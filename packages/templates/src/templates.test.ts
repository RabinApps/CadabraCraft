import { describe, expect, it } from "vitest";
import { GALLERY_TEMPLATE_IDS, getTemplate, hasTemplate, listTemplates, TemplateError, validateTemplate, type Template } from "./index";

describe("template registry", () => {
  it("ships novel, nonfiction, modern and poetry", () => {
    expect(listTemplates().map((t) => t.id)).toEqual(["novel", "nonfiction", "modern", "poetry"]);
  });
  it("every template is well-formed", () => {
    for (const t of listTemplates()) expect(validateTemplate(t), t.id).toEqual([]);
  });
  it("EPUB css follows the chapter opening data", () => {
    expect(getTemplate("novel").epub.css).toContain("h1+p::first-letter");
    expect(getTemplate("novel").epub.css).toContain('content:"⁂"');
    expect(getTemplate("poetry").epub.css).not.toContain("::first-letter");
  });
  it("rejects a multi-character ornament", () => {
    const bad = structuredClone(getTemplate("novel"));
    bad.print.chapterOpening.ornament = "ab";
    expect(validateTemplate(bad)).toContain("print.chapterOpening.ornament must be null or a single character");
  });
  it("getTemplate returns by id and errors on unknown ids", () => {
    expect(getTemplate("novel").name).toBe("Classic Novel");
    expect(() => getTemplate("nope")).toThrow(TemplateError);
    expect(() => getTemplate("nope")).toThrow(/novel, nonfiction, modern, poetry/);
    expect(hasTemplate("modern")).toBe(true);
    expect(hasTemplate("")).toBe(false);
  });
  it("EPUB css is non-empty and has no remote loads", () => {
    for (const t of listTemplates()) {
      expect(t.epub.css).toContain("hr.scene-break");
      expect(t.epub.css).not.toMatch(/https?:/);
    }
  });
  it("novel has indents, nonfiction spaces, modern is sans with fallbacks", () => {
    expect(getTemplate("novel").print.paragraph.style).toBe("indent");
    expect(getTemplate("novel").print.chapterOpening.startOn).toBe("recto");
    expect(getTemplate("nonfiction").print.paragraph.style).toBe("spaced");
    expect(getTemplate("nonfiction").print.chapterOpening.label).toBe("Chapter {n}");
    expect(getTemplate("modern").print.bodyFonts.length).toBeGreaterThan(1);
  });
  it("validation catches bad data", () => {
    const bad = structuredClone(getTemplate("novel")) as Template;
    bad.id = "Bad Id";
    bad.print.fontSizePt = 400;
    bad.print.bodyFonts = [];
    bad.print.chapterOpening.label = "Chapter";
    bad.epub.css = '@import url("https://x.test/a.css");';
    const errs = validateTemplate(bad).join("|");
    expect(errs).toMatch(/kebab-case/);
    expect(errs).toMatch(/fontSizePt/);
    expect(errs).toMatch(/bodyFonts/);
    expect(errs).toMatch(/label/);
    expect(errs).toMatch(/remote/);
  });
});

describe("gallery", () => {
  it("offers the three designed looks, and every gallery id is a registered template", () => {
    expect(GALLERY_TEMPLATE_IDS).toEqual(["novel", "modern", "poetry"]);
    for (const id of GALLERY_TEMPLATE_IDS) expect(hasTemplate(id)).toBe(true);
    expect(getTemplate("poetry").name).toBe("Poetry");
    expect(getTemplate("poetry").epub.css).toContain("text-align:center");
  });
});
