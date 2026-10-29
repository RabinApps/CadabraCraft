import { describe, expect, it } from "vitest";
import { TRIM_SIZES, type TrimSize } from "@cadabracraft/export-pdf";
import { getTemplate, listTemplates } from "@cadabracraft/templates";
import {
  CAP_HEIGHT_EM,
  PAGE_ZOOMS,
  PX_PER_INCH,
  fitZoom,
  fontKindOf,
  linePitchEm,
  pageCssVars,
  pageFillSlackPx,
  pageGeometry,
  paginate,
  sideMargins,
  type BlockKind,
  type MeasuredBlock,
} from "../pageLayout";

const BUILTIN = ["novel", "nonfiction", "modern", "poetry"];
const px = (v: string | undefined): number => parseFloat(v ?? "NaN");

describe("pageGeometry", () => {
  it("is the template's default trim and margins in px at zoom 1", () => {
    const g = pageGeometry({ template: "novel" });
    expect(g.trimIn).toEqual({ w: 5.5, h: 8.5 });
    expect(g.page).toEqual({ w: 5.5 * PX_PER_INCH, h: 8.5 * PX_PER_INCH });
    expect(g.margins.top).toBeCloseTo(0.8 * 96);
    expect(g.margins.bottom).toBeCloseTo(0.9 * 96);
    expect(g.margins.inside).toBeCloseTo(0.9 * 96);
    expect(g.margins.outside).toBeCloseTo(0.65 * 96);
    expect(g.text.w).toBeCloseTo(528 - 0.9 * 96 - 0.65 * 96);
    expect(g.text.h).toBeCloseTo(816 - 0.8 * 96 - 0.9 * 96);
  });

  it("uses the book's own trim size over the template default", () => {
    const g = pageGeometry({ template: "novel", trimSize: "6x9" });
    expect(g.page).toEqual({ w: 576, h: 864 });
    expect(g.page.w / g.page.h).toBeCloseTo(6 / 9);
  });

  it.each(BUILTIN)("is consistent for %s on every trim size", (template) => {
    for (const trim of Object.keys(TRIM_SIZES) as TrimSize[]) {
      const g = pageGeometry({ template, trimSize: trim });
      const m = getTemplate(template).print.defaults.marginsIn;
      expect(g.trimIn).toEqual(TRIM_SIZES[trim]);
      expect(g.page.w).toBeCloseTo(TRIM_SIZES[trim].w * 96);
      expect(g.page.h).toBeCloseTo(TRIM_SIZES[trim].h * 96);
      expect(g.margins.inside).toBeCloseTo(m.inside * 96);
      expect(g.margins.outside).toBeCloseTo(m.outside * 96);
      expect(g.text.w).toBeCloseTo(g.page.w - g.margins.inside - g.margins.outside);
      expect(g.text.h).toBeCloseTo(g.page.h - g.margins.top - g.margins.bottom);
      expect(g.text.w).toBeGreaterThan(0);
      expect(g.text.h).toBeGreaterThan(0);
    }
  });

  it("falls back to the default template for an unknown one", () => {
    expect(pageGeometry({ template: "gone" })).toEqual(pageGeometry({ template: "novel" }));
    expect(pageCssVars({ template: "gone" })).toEqual(pageCssVars({ template: "novel" }));
  });
});

describe("sideMargins", () => {
  const g = pageGeometry({ template: "novel" });
  it("puts the inside margin on the left of odd (recto) pages", () => {
    expect(sideMargins(g, 1)).toEqual({ left: g.margins.inside, right: g.margins.outside });
    expect(sideMargins(g, 7)).toEqual({ left: g.margins.inside, right: g.margins.outside });
  });
  it("puts the inside margin on the right of even (verso) pages", () => {
    expect(sideMargins(g, 2)).toEqual({ left: g.margins.outside, right: g.margins.inside });
    expect(sideMargins(g, 100)).toEqual({ left: g.margins.outside, right: g.margins.inside });
  });
  it("always leaves the text width in between", () => {
    for (const n of [1, 2, 3, 4]) {
      const { left, right } = sideMargins(g, n);
      expect(g.page.w - left - right).toBeCloseTo(g.text.w);
    }
  });
});

describe("fitZoom", () => {
  const g = pageGeometry({ template: "novel" }); // 528 px wide
  it("fills the pane minus the gutter", () => {
    expect(fitZoom(g, 1000, 48)).toBeCloseTo((1000 - 48) / 528);
  });
  it("defaults the gutter", () => {
    expect(fitZoom(g, 1000)).toBeCloseTo(952 / 528);
  });
  it("clamps to 0.3 and 2", () => {
    expect(fitZoom(g, 100, 48)).toBe(0.3);
    expect(fitZoom(g, 0, 0)).toBe(0.3);
    expect(fitZoom(g, 5000, 0)).toBe(2);
  });
  it("falls back to 1 for a non-finite width", () => {
    expect(fitZoom(g, Number.NaN)).toBe(1);
  });
  it("lists the fixed zoom steps", () => {
    expect([...PAGE_ZOOMS]).toEqual([0.75, 1, 1.25]);
  });
});

describe("font kind and line pitch", () => {
  it("classifies the built-in fonts", () => {
    expect(fontKindOf("novel")).toBe("serif");
    expect(fontKindOf("poetry")).toBe("serif");
    expect(fontKindOf("modern")).toBe("sans");
  });
  it("line pitch is cap height plus the template leading", () => {
    expect(linePitchEm({ template: "novel" })).toBeCloseTo(CAP_HEIGHT_EM.serif + 0.62);
    expect(linePitchEm({ template: "modern" })).toBeCloseTo(CAP_HEIGHT_EM.sans + 0.75);
  });
  it("page fill slack covers the trailing leading", () => {
    const fontPx = (11 * 96) / 72;
    expect(pageFillSlackPx({ template: "novel" })).toBeGreaterThan(0.62 * fontPx);
    expect(pageFillSlackPx({ template: "novel" })).toBeLessThan(
      linePitchEm({ template: "novel" }) * fontPx * 2,
    );
  });
});

describe("pageCssVars", () => {
  const KEYS = [
    "--page-w",
    "--page-h",
    "--page-text-w",
    "--page-text-h",
    "--page-font-size",
    "--page-line-height",
    "--page-indent",
    "--page-para-space",
    "text-align",
    "hyphens",
    "--page-h1-size",
    "--page-h1-above",
    "--page-h1-below",
    "--page-h1-align",
    "--page-h1-weight",
    "--page-h1-style",
    "--page-h1-variant",
    "--page-h2-size",
    "--page-h2-above",
    "--page-h2-below",
    "--page-h2-align",
    "--page-h2-weight",
    "--page-h2-style",
    "--page-h2-variant",
    "--page-h3-size",
    "--page-h3-above",
    "--page-h3-below",
    "--page-h3-align",
    "--page-h3-weight",
    "--page-h3-style",
    "--page-h3-variant",
    "--page-chapter-sink",
    "--page-chapter-extra",
    "--page-chapter-ornament",
    "--page-chapter-ornament-size",
    "--page-chapter-ornament-h",
    "--page-chapter-ornament-top",
    "--page-chapter-label",
    "--page-chapter-label-size",
    "--page-chapter-label-h",
    "--page-chapter-label-top",
    "--page-dropcap-lines",
    "--page-dropcap-float",
    "--page-dropcap-size",
    "--page-dropcap-lh",
    "--page-dropcap-gap",
    "--page-dropcap-height",
    "--page-bq-indent",
    "--page-bq-size",
    "--page-bq-space",
    "--page-bq-style",
    "--page-bq-rule",
    "--page-scene-glyph",
    "--page-scene-space",
  ];

  it.each(BUILTIN)("has every key as a string for %s", (template) => {
    const v = pageCssVars({ template });
    expect(Object.keys(v).sort()).toEqual([...KEYS].sort());
    for (const value of Object.values(v)) expect(typeof value).toBe("string");
  });

  it.each(BUILTIN)("matches the template's print settings for %s", (template) => {
    const p = getTemplate(template).print;
    const book = { template };
    const g = pageGeometry(book);
    const v = pageCssVars(book);
    const fontPx = (p.fontSizePt * 96) / 72;
    expect(v["--page-w"]).toBe(`${g.page.w}px`);
    expect(v["--page-h"]).toBe(`${g.page.h}px`);
    expect(px(v["--page-text-w"])).toBeCloseTo(g.text.w, 2);
    expect(px(v["--page-text-h"])).toBeCloseTo(g.text.h, 2);
    expect(px(v["--page-font-size"])).toBeCloseTo(fontPx, 2);
    expect(Number(v["--page-line-height"])).toBeCloseTo(linePitchEm(book), 3);
    expect(v["text-align"]).toBe(p.justify ? "justify" : "left");
    expect(v.hyphens).toBe(p.hyphenate ? "auto" : "manual");
    expect(v["--page-indent"]).toBe(
      `${p.paragraph.style === "indent" ? p.paragraph.indentEm : 0}em`,
    );
    const spacing = p.paragraph.style === "indent" ? p.leadingEm : p.paragraph.spacingEm;
    expect(px(v["--page-para-space"])).toBeCloseTo(spacing - p.leadingEm, 3);
    for (const l of [1, 2, 3] as const) {
      const h = p.headings[l];
      expect(v[`--page-h${l}-size`]).toBe(`${h.sizeEm}em`);
      expect(px(v[`--page-h${l}-below`])).toBeCloseTo(h.spaceBelowEm * fontPx, 2);
      expect(px(v[`--page-h${l}-above`])).toBeCloseTo(l === 1 ? 0 : h.spaceAboveEm * fontPx, 2);
      expect(v[`--page-h${l}-align`]).toBe(h.align);
      expect(v[`--page-h${l}-weight`]).toBe(h.bold ? "700" : "400");
      expect(v[`--page-h${l}-style`]).toBe(h.italic ? "italic" : "normal");
      expect(v[`--page-h${l}-variant`]).toBe(h.smallCaps ? "small-caps" : "normal");
    }
    expect(px(v["--page-chapter-sink"])).toBeCloseTo(p.chapterOpening.sinkEm * fontPx, 2);
    const q = p.blockQuote;
    expect(px(v["--page-bq-indent"])).toBeCloseTo(q.indentEm * fontPx, 2);
    expect(v["--page-bq-size"]).toBe(`${q.sizeEm}em`);
    expect(px(v["--page-bq-space"])).toBeCloseTo(q.spaceEm * fontPx, 2);
    expect(v["--page-bq-style"]).toBe(q.italic ? "italic" : "normal");
    expect(v["--page-bq-rule"] === "none").toBe(!q.ruleLeft);
    expect(v["--page-scene-glyph"]).toBe(JSON.stringify(p.sceneBreak.glyph));
    expect(px(v["--page-scene-space"])).toBeCloseTo(p.sceneBreak.spaceEm * fontPx, 2);
  });

  it("has known values for the novel template", () => {
    const v = pageCssVars({ template: "novel" });
    expect(v["--page-w"]).toBe("528px");
    expect(v["--page-h"]).toBe("816px");
    expect(v["--page-font-size"]).toBe("14.667px");
    expect(v["--page-line-height"]).toBe("1.28");
    expect(v["--page-indent"]).toBe("1.4em");
    expect(v["--page-para-space"]).toBe("0em");
    expect(v["text-align"]).toBe("justify");
    expect(v.hyphens).toBe("auto");
    expect(v["--page-h1-size"]).toBe("1.7em");
    expect(v["--page-h1-align"]).toBe("center");
  });

  it("derives paragraph space from spacing minus leading, and allows a negative value", () => {
    expect(pageCssVars({ template: "nonfiction" })["--page-para-space"]).toBe("0.2em");
    expect(pageCssVars({ template: "nonfiction" })["--page-indent"]).toBe("0em");
    expect(pageCssVars({ template: "poetry" })["--page-para-space"]).toBe("-0.25em");
  });

  it("counts the ornament and the label in the chapter extra", () => {
    expect(px(pageCssVars({ template: "novel" })["--page-chapter-extra"])).toBeGreaterThan(0); // ornament
    expect(px(pageCssVars({ template: "nonfiction" })["--page-chapter-extra"])).toBeGreaterThan(0); // label
    expect(pageCssVars({ template: "modern" })["--page-chapter-extra"]).toBe("0px");
  });

  it("draws the ornament above the label and reserves exactly their height", () => {
    const v = pageCssVars({ template: "novel" }, 2);
    expect(v["--page-chapter-ornament"]).toBe('"⁂"');
    expect(v["--page-chapter-label"]).toBe("none"); // novel has no label
    expect(px(v["--page-chapter-ornament-top"])).toBeCloseTo(-px(v["--page-chapter-extra"]), 2);
    const n = pageCssVars({ template: "nonfiction" }, 3);
    expect(n["--page-chapter-ornament"]).toBe("none");
    expect(n["--page-chapter-label"]).toBe('"CHAPTER 3"'); // {n} filled, uppercase as the PDF
    expect(px(n["--page-chapter-label-top"])).toBeCloseTo(-px(n["--page-chapter-extra"]), 2);
  });

  it("shows no label without a chapter number (front and back matter)", () => {
    expect(pageCssVars({ template: "nonfiction" })["--page-chapter-label"]).toBe("none");
    expect(pageCssVars({ template: "modern" }, 1)["--page-chapter-label"]).toBe("none");
  });

  it("spans the drop cap over 3 line pitches and turns it off for templates without one", () => {
    const v = pageCssVars({ template: "novel" });
    expect(v["--page-dropcap-float"]).toBe("left");
    const fontPx = px(v["--page-font-size"]);
    expect(px(v["--page-dropcap-height"])).toBeCloseTo(
      3 * linePitchEm({ template: "novel" }) * fontPx,
      1,
    );
    // box height (size x line-height) equals the reservation
    expect(px(v["--page-dropcap-size"]) * Number(v["--page-dropcap-lh"]) * fontPx).toBeCloseTo(
      px(v["--page-dropcap-height"]),
      0,
    );
    const off = pageCssVars({ template: "modern" });
    expect(off["--page-dropcap-float"]).toBe("none");
    expect(off["--page-dropcap-height"]).toBe("0px");
    expect(off["--page-dropcap-lh"]).toBe("inherit");
  });

  it("follows the page size when the trim changes", () => {
    const v = pageCssVars({ template: "modern", trimSize: "8.5x11" });
    expect(v["--page-w"]).toBe("816px");
    expect(v["--page-h"]).toBe("1056px");
  });

  it("covers every registered template", () => {
    for (const t of listTemplates())
      expect(pageCssVars({ template: t.id })["--page-w"]).toMatch(/px$/);
  });
});

// Blocks use a 10 px line and a 100 px (10 line) page unless noted.
const LH = 10;
const H = 100;
const block = (kind: BlockKind, lines: number, o: Partial<MeasuredBlock> = {}): MeasuredBlock => ({
  kind,
  height: lines * LH,
  marginTop: 0,
  marginBottom: 0,
  lineHeight: LH,
  lines,
  ...o,
});
const para = (lines: number, o: Partial<MeasuredBlock> = {}) => block("paragraph", lines, o);
const heading = (o: Partial<MeasuredBlock> = {}) => block("heading", 1, o);
const rect = (kind: BlockKind, height: number, o: Partial<MeasuredBlock> = {}): MeasuredBlock => ({
  kind,
  height,
  marginTop: 0,
  marginBottom: 0,
  lineHeight: 0,
  lines: 0,
  ...o,
});
const plain = { firstPage: 1, startsOn: "any" as const, opensChapter: false };
const brk = (block: number, linesBefore = 0, blankBefore = false) => ({
  block,
  linesBefore,
  blankBefore,
});

describe("paginate: basics", () => {
  it("has no pages for no blocks", () => {
    expect(paginate([], H, plain)).toEqual({ breaks: [], pageCount: 0 });
    expect(paginate([], H, { firstPage: 2, startsOn: "recto", opensChapter: true })).toEqual({
      breaks: [],
      pageCount: 0,
    });
  });

  it("uses forced breaks as they are, whatever the blocks would do, and still adds a blank verso", () => {
    const forced = [
      { block: 1, linesBefore: 0, blankBefore: false },
      { block: 1, linesBefore: 2, blankBefore: false },
    ];
    // Three short paragraphs would fit one page.
    expect(paginate([para(1), para(3), para(1)], H, { ...plain, forced })).toEqual({
      breaks: forced,
      pageCount: 3,
    });
    expect(paginate([para(1)], H, { ...plain, forced: [] })).toEqual({ breaks: [], pageCount: 1 });
    expect(
      paginate([para(1), para(1)], H, {
        firstPage: 2,
        startsOn: "recto",
        opensChapter: true,
        forced: forced.slice(0, 1),
      }),
    ).toEqual({
      breaks: [{ block: 0, linesBefore: 0, blankBefore: true }, forced[0]],
      pageCount: 3,
    });
  });

  it("keeps a short chapter on one page", () => {
    expect(paginate([para(3), para(2)], H, plain)).toEqual({ breaks: [], pageCount: 1 });
  });

  it("fills a page exactly without breaking", () => {
    expect(paginate([para(10)], H, plain)).toEqual({ breaks: [], pageCount: 1 });
    expect(paginate([para(4), para(6)], H, plain)).toEqual({ breaks: [], pageCount: 1 });
  });

  it("breaks before a block that no longer fits and cannot split", () => {
    const r = paginate([para(10), para(1)], H, plain);
    expect(r).toEqual({ breaks: [brk(1)], pageCount: 2 });
  });

  it("makes many pages", () => {
    const blocks = Array.from({ length: 10 }, () => para(10));
    const r = paginate(blocks, H, plain);
    expect(r.pageCount).toBe(10);
    expect(r.breaks).toEqual(Array.from({ length: 9 }, (_, i) => brk(i + 1)));
  });

  it("always has one more page than breaks", () => {
    for (const lines of [1, 5, 10, 11, 25, 99]) {
      const r = paginate([para(lines), para(lines)], H, plain);
      expect(r.pageCount).toBe(r.breaks.length + 1);
    }
  });
});

describe("paginate: splitting paragraphs", () => {
  it("splits at a line boundary and keeps the rest on the next page", () => {
    // 5 lines of room, 10 lines of paragraph: 5 stay, 5 move.
    expect(paginate([para(5), para(10)], H, plain)).toEqual({ breaks: [brk(1, 5)], pageCount: 2 });
  });

  it("splits a long paragraph over several pages", () => {
    const r = paginate([para(35)], H, plain);
    expect(r.pageCount).toBe(4);
    expect(r.breaks).toEqual([brk(0, 10), brk(0, 20), brk(0, 30)]);
  });

  it("splits a long paragraph that starts mid page", () => {
    const r = paginate([para(3), para(25)], H, plain);
    expect(r.breaks).toEqual([brk(1, 7), brk(1, 17)]);
    expect(r.pageCount).toBe(3);
  });

  it("moves a paragraph whole when only one line (an orphan) would stay", () => {
    expect(paginate([para(9), para(4)], H, plain)).toEqual({ breaks: [brk(1)], pageCount: 2 });
  });

  it("allows two lines before the break", () => {
    expect(paginate([para(8), para(4)], H, plain)).toEqual({ breaks: [brk(1, 2)], pageCount: 2 });
  });

  it("pulls a line back when only one line (a widow) would carry over", () => {
    // 5 lines of room, 6-line paragraph: 5 + 1 would leave a widow, so 4 + 2.
    expect(paginate([para(5), para(6)], H, plain).breaks).toEqual([brk(1, 4)]);
  });

  it("moves a short paragraph whole when pulling a line back would leave an orphan", () => {
    // 2 lines of room, 3-line paragraph: 2 + 1 is a widow, 1 + 2 is an orphan.
    expect(paginate([para(8), para(3)], H, plain).breaks).toEqual([brk(1)]);
  });

  it("does not split a block that cannot be split in two valid halves and still fits whole on the next page", () => {
    expect(paginate([para(7), para(3)], H, plain)).toEqual({ breaks: [], pageCount: 1 });
    expect(paginate([para(9), para(3)], H, plain).breaks).toEqual([brk(1)]);
  });

  it("splits a quote, list and code block like a paragraph", () => {
    for (const kind of ["blockquote", "list", "code"] as const) {
      expect(paginate([para(5), block(kind, 10)], H, plain).breaks).toEqual([brk(1, 5)]);
    }
  });

  it("never splits a table, image or other block", () => {
    for (const kind of ["table", "image", "other", "sceneBreak"] as const) {
      expect(paginate([para(5), block(kind, 6)], H, plain).breaks).toEqual([brk(1)]);
    }
  });

  it("keeps extra height (padding) of a split block on its last piece", () => {
    // 4 lines but 45 px tall: 40 px of room fits 4 lines of text yet not the padding; widow rule leaves 2 + 2.
    expect(paginate([para(6), para(4, { height: 45 })], H, plain).breaks).toEqual([brk(1, 2)]);
  });

  it("terminates on a page shorter than two lines", () => {
    const r = paginate([para(5)], 15, plain);
    expect(r.pageCount).toBe(5);
    expect(r.breaks).toEqual([brk(0, 1), brk(0, 2), brk(0, 3), brk(0, 4)]);
  });

  it("splits at the top of a page even when the orphan rule cannot be met", () => {
    // room for 1 line only (page height 15), 3-line paragraph: forced 1 + 2.
    expect(paginate([para(3)], 15, plain).breaks).toEqual([brk(0, 1), brk(0, 2)]);
  });
});

describe("paginate: margins", () => {
  it("collapses adjacent margins to the larger one", () => {
    // 50 + 20 (not 20 + 10) + room 30: second paragraph splits 3 + 2.
    const r = paginate([para(5, { marginBottom: 20 }), para(5, { marginTop: 10 })], H, plain);
    expect(r.breaks).toEqual([brk(1, 3)]);
  });

  it("fits when collapsed margins leave exactly enough room", () => {
    const r = paginate([para(4, { marginBottom: 20 }), para(4, { marginTop: 20 })], H, plain);
    expect(r).toEqual({ breaks: [], pageCount: 1 }); // 40 + 20 + 40
  });

  it("lets a negative margin pull blocks together", () => {
    const blocks = [para(5, { marginBottom: -10 }), para(5)];
    expect(paginate(blocks, H, plain)).toEqual({ breaks: [], pageCount: 1 }); // 50 - 10 + 50 = 90
  });

  it("adds the most negative to the largest positive margin", () => {
    // gap = 30 + -10 = 20: 50 + 20 + 40 = 110 > 100
    const r = paginate([para(5, { marginBottom: 30 }), para(4, { marginTop: -10 })], H, plain);
    expect(r.breaks.length).toBe(1);
    const fit = paginate([para(5, { marginBottom: 30 }), para(3, { marginTop: -10 })], H, plain);
    expect(fit.breaks).toEqual([]); // 50 + 20 + 30 = 100
  });

  it("drops the top margin of a block at the top of a page", () => {
    // Without dropping 40 the second page would not hold 10 + 6 lines.
    const r = paginate(
      [para(10), para(10, { marginTop: 40 }), para(0 + 0, { marginTop: 0, height: 0, lines: 0 })],
      H,
      plain,
    );
    expect(r.pageCount).toBe(2);
  });

  it("keeps a chapter title's own top margin (the sink) at the top of a page", () => {
    // Title 10 + sink 50 = 60; 40 left: a 5-line paragraph splits 3 + 2.
    const title = block("chapterTitle", 1, { marginTop: 50 });
    const r = paginate([title, para(5)], H, { ...plain, opensChapter: true });
    expect(r.breaks).toEqual([brk(1, 3)]);
  });
});

describe("paginate: keep with next", () => {
  it("moves a heading to the next page when it would end a page", () => {
    // y = 80, heading 10 fits, but only 10 left and the next paragraph needs 2 lines.
    const r = paginate([para(8), heading(), para(5)], H, plain);
    expect(r.breaks).toEqual([brk(1)]);
    expect(r.pageCount).toBe(2);
  });

  it("keeps a heading with the first lines of the next paragraph when they fit", () => {
    const r = paginate([para(6), heading(), para(5)], H, plain);
    // heading at line 7, paragraph gets 3 lines (+2 carried over).
    expect(r.breaks).toEqual([brk(2, 3)]);
  });

  it("leaves a heading at the bottom when the next block fits whole beside it", () => {
    expect(paginate([para(7), heading(), para(2)], H, plain)).toEqual({ breaks: [], pageCount: 1 });
  });

  it("needs only the first two lines of a long next paragraph", () => {
    // Heading at the very last two slots: 8 + 1 + 1: the paragraph's two lines do not fit, so the heading moves.
    expect(paginate([para(8), heading(), para(30)], H, plain).breaks[0]).toEqual(brk(1));
    expect(paginate([para(7), heading(), para(30)], H, plain).breaks[0]).toEqual(brk(2, 2));
  });

  it("needs the whole next block when it cannot split", () => {
    const r = paginate([para(7), heading(), block("table", 3)], H, plain);
    expect(r.breaks).toEqual([brk(1)]);
  });

  it("moves a chapter title and the heading after it together", () => {
    const title = block("chapterTitle", 1);
    const r = paginate([para(7), title, heading(), para(5)], H, plain);
    expect(r.breaks[0]).toEqual(brk(1));
  });

  it("honours an explicit keepWithNext on any block", () => {
    const r = paginate([para(8), para(1, { keepWithNext: true }), para(5)], H, plain);
    expect(r.breaks[0]).toEqual(brk(1));
  });

  it("lets a heading opt out with keepWithNext: false", () => {
    const r = paginate([para(9), heading({ keepWithNext: false }), para(5)], H, plain);
    expect(r.breaks).toEqual([brk(2)]);
  });

  it("does nothing special for a heading that is the last block", () => {
    expect(paginate([para(9), heading()], H, plain)).toEqual({ breaks: [], pageCount: 1 });
  });

  it("places a heading that is taller than the page at the top and moves on", () => {
    const r = paginate([heading({ height: 300 }), para(2)], H, plain);
    expect(r.pageCount).toBe(2);
  });
});

describe("paginate: chapter opening", () => {
  const one = [para(3)];
  it("inserts a blank verso when a recto chapter would start on an even page", () => {
    const r = paginate(one, H, { firstPage: 2, startsOn: "recto", opensChapter: true });
    expect(r).toEqual({ breaks: [brk(0, 0, true)], pageCount: 2 });
  });

  it("inserts no blank page when the chapter lands on a recto", () => {
    const r = paginate(one, H, { firstPage: 3, startsOn: "recto", opensChapter: true });
    expect(r).toEqual({ breaks: [], pageCount: 1 });
    expect(
      paginate(one, H, { firstPage: 1, startsOn: "recto", opensChapter: true }).breaks,
    ).toEqual([]);
  });

  it("inserts no blank page for start on any page", () => {
    for (const firstPage of [1, 2, 3, 4]) {
      const r = paginate(one, H, { firstPage, startsOn: "any", opensChapter: true });
      expect(r).toEqual({ breaks: [], pageCount: 1 });
    }
  });

  it("does not apply the rule when the content does not open a chapter", () => {
    const r = paginate(one, H, { firstPage: 2, startsOn: "recto", opensChapter: false });
    expect(r).toEqual({ breaks: [], pageCount: 1 });
  });

  it("counts the blank page and later breaks stay in order", () => {
    const r = paginate([para(15)], H, { firstPage: 2, startsOn: "recto", opensChapter: true });
    expect(r.breaks).toEqual([brk(0, 0, true), brk(0, 10)]);
    expect(r.pageCount).toBe(3);
    expect(r.breaks.filter((b) => b.blankBefore)).toHaveLength(1);
  });

  it("starts the chapter on a new page: the first block opens the first page", () => {
    const title = block("chapterTitle", 1, { marginTop: 30 });
    const r = paginate([title, para(2)], H, {
      firstPage: 5,
      startsOn: "recto",
      opensChapter: true,
    });
    expect(r).toEqual({ breaks: [], pageCount: 1 });
  });
});

describe("paginate: oversized and empty blocks", () => {
  it("puts a block taller than a page on a page of its own", () => {
    const r = paginate([para(2), rect("image", 250), para(2)], H, plain);
    expect(r.breaks).toEqual([brk(1), brk(2)]);
    expect(r.pageCount).toBe(3);
  });

  it("lets an oversized block alone fill one page", () => {
    expect(paginate([rect("image", 250)], H, plain)).toEqual({ breaks: [], pageCount: 1 });
  });

  it("puts an oversized block at the top of an empty page without a blank first page", () => {
    expect(paginate([rect("table", 101), rect("table", 20)], H, plain).breaks).toEqual([brk(1)]);
  });

  it("does not split a taller than page block without lines", () => {
    const r = paginate([rect("paragraph", 300)], H, plain);
    expect(r).toEqual({ breaks: [], pageCount: 1 });
  });

  it("ignores zero-height blocks", () => {
    const zero = rect("other", 0);
    expect(paginate([zero], H, plain)).toEqual({ breaks: [], pageCount: 1 });
    expect(paginate([para(10), zero], H, plain)).toEqual({ breaks: [], pageCount: 1 });
    expect(paginate([zero, para(10), zero, zero], H, plain)).toEqual({ breaks: [], pageCount: 1 });
  });

  it("lets zero-height blocks with margins sit between full pages", () => {
    const zero = rect("other", 0, { marginTop: 5, marginBottom: 5 });
    const r = paginate([para(10), zero, para(10)], H, plain);
    expect(r.pageCount).toBe(2);
  });

  it("copes with a zero text height without looping", () => {
    const r = paginate([para(3), heading()], 0, plain);
    expect(r.pageCount).toBeGreaterThan(0);
    expect(r.pageCount).toBe(r.breaks.length + 1);
  });
});
