import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_TEMPLATE_ID,
  GALLERY_TEMPLATE_IDS,
  getTemplate,
  hasTemplate,
  listTemplates,
  resolveTrimSize,
  TemplateError,
  validateTemplate,
  type Template,
} from "../index";

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
    expect(validateTemplate(bad)).toContain(
      "print.chapterOpening.ornament must be null or a single character",
    );
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

describe("validation of malformed templates", () => {
  const novel = () => structuredClone(getTemplate("novel"));
  const junk = (v: unknown) => v as never;

  it("reports a missing print block and missing fields on an empty object", () => {
    const errs = validateTemplate({} as Template);
    expect(errs).toContain("id must be lowercase kebab-case");
    expect(errs).toContain("name required");
    expect(errs).toContain("description required");
    expect(errs).toContain("print settings missing");
  });

  it("reports every field of an empty print and epub block", () => {
    const errs = validateTemplate({
      id: "x",
      name: "n",
      description: "d",
      print: {},
      epub: {},
    } as never);
    expect(errs).toEqual(
      expect.arrayContaining([
        "print.bodyFonts needs at least one family",
        "print.headingFonts must be a list of families",
        "print.fontSizePt out of range",
        "print.leadingEm out of range",
        "print.paragraph.style must be indent or spaced",
        "print.paragraph.indentEm out of range",
        "print.paragraph.spacingEm out of range",
        "print.headings.1 missing",
        "print.headings.2 missing",
        "print.headings.3 missing",
        "print.chapterOpening.startOn must be recto or any",
        "print.chapterOpening.sinkEm out of range",
        "print.chapterOpening.label must be null or contain {n}",
        "print.chapterOpening.dropCap must be true or false",
        "print.chapterOpening.ornament must be null or a single character",
        "print.blockQuote.indentEm out of range",
        "print.blockQuote.sizeEm out of range",
        "print.blockQuote.spaceEm out of range",
        "print.sceneBreak.glyph required",
        "print.sceneBreak.spaceEm out of range",
        "print.runningText.sizePt out of range",
        "print.footnoteSizeEm out of range",
        "print.defaults.marginsIn.top out of range",
        "print.defaults.marginsIn.inside out of range",
        "epub.css required",
      ]),
    );
    expect(errs.some((e) => e.startsWith("print.defaults.trimSize"))).toBe(true);
  });

  it("reports a heading style with every field out of range", () => {
    const t = novel();
    t.print.headings[2] = junk({ sizeEm: 99, spaceAboveEm: 99, spaceBelowEm: 99, align: "right" });
    const errs = validateTemplate(t);
    expect(errs).toEqual([
      "print.headings.2.sizeEm out of range",
      "print.headings.2.spaceAboveEm out of range",
      "print.headings.2.spaceBelowEm out of range",
      "print.headings.2.align must be left or center",
    ]);
  });

  it("rejects non-array fonts, blank fonts, non-finite and non-numeric numbers", () => {
    const t = novel();
    t.print.bodyFonts = junk("serif");
    t.print.headingFonts = junk(["ok", ""]);
    t.print.fontSizePt = junk(Number.NaN);
    t.print.leadingEm = junk("1.4");
    const errs = validateTemplate(t);
    expect(errs).toContain("print.bodyFonts needs at least one family");
    expect(errs).toContain("print.headingFonts must be a list of families");
    expect(errs).toContain("print.fontSizePt out of range");
    expect(errs).toContain("print.leadingEm out of range");
  });

  it("rejects non-string and blank names and descriptions, and a non-string label or ornament", () => {
    const t = novel();
    t.name = junk(5);
    t.description = "   ";
    t.print.chapterOpening.label = junk(3);
    t.print.chapterOpening.ornament = junk(3);
    t.print.chapterOpening.dropCap = junk("yes");
    const errs = validateTemplate(t);
    expect(errs).toEqual(
      expect.arrayContaining([
        "name required",
        "description required",
        "print.chapterOpening.label must be null or contain {n}",
        "print.chapterOpening.ornament must be null or a single character",
        "print.chapterOpening.dropCap must be true or false",
      ]),
    );
  });

  it("accepts a null label and ornament, and rejects remote url() in epub css", () => {
    const t = novel();
    t.print.chapterOpening.label = null;
    t.print.chapterOpening.ornament = null;
    expect(validateTemplate(t)).toEqual([]);
    t.epub.css = "a{background:url( 'https://x.test/a.png')}";
    expect(validateTemplate(t)).toContain("epub.css must not load remote resources");
  });
});

describe("resolveTrimSize", () => {
  it("prefers the book's own size, then the template's default, then the default template's", () => {
    expect(resolveTrimSize({ template: "novel", trimSize: "7x10" })).toBe("7x10");
    expect(resolveTrimSize({ template: "nonfiction" })).toBe(
      getTemplate("nonfiction").print.defaults.trimSize,
    );
    expect(resolveTrimSize({ template: "gone" })).toBe(
      getTemplate(DEFAULT_TEMPLATE_ID).print.defaults.trimSize,
    );
  });
});

describe("registry construction", () => {
  const loadWith = async (list: unknown[]) => {
    vi.resetModules();
    vi.doMock("../builtin", () => ({ BUILTIN_TEMPLATES: list, GALLERY_TEMPLATE_IDS: [] }));
    try {
      return await import("../registry");
    } finally {
      vi.doUnmock("../builtin");
      vi.resetModules();
    }
  };
  it("refuses a duplicate built-in id", async () => {
    const t = getTemplate("novel");
    await expect(loadWith([t, t])).rejects.toThrow(/Duplicate template id "novel"/);
  });
  it("refuses an invalid built-in template", async () => {
    const bad = { ...structuredClone(getTemplate("novel")), name: "" };
    await expect(loadWith([bad])).rejects.toThrow(/Invalid template "novel": name required/);
  });
});
