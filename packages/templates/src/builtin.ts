import { MODERN_CSS, NONFICTION_CSS, NOVEL_CSS } from "./css";
import type { PrintHeadingStyle, Template } from "./types";

const h = (o: Partial<PrintHeadingStyle>): PrintHeadingStyle => ({
  sizeEm: 1, bold: false, italic: false, smallCaps: false, align: "left", spaceAboveEm: 1.5, spaceBelowEm: 0.6, ...o,
});

const SERIF = ["Libertinus Serif"];

export const novel: Template = {
  id: "novel",
  name: "Novel",
  description: "Clean literary layout: indented paragraphs, no paragraph spacing, centered chapter titles, chapters start on right-hand pages.",
  print: {
    bodyFonts: SERIF,
    headingFonts: [],
    fontSizePt: 11,
    leadingEm: 0.62,
    justify: true,
    hyphenate: true,
    paragraph: { style: "indent", indentEm: 1.4, spacingEm: 0 },
    headings: {
      1: h({ sizeEm: 1.7, align: "center", spaceBelowEm: 2.2 }),
      2: h({ sizeEm: 1.2, align: "center", smallCaps: true, spaceAboveEm: 2, spaceBelowEm: 1 }),
      3: h({ sizeEm: 1, italic: true, spaceAboveEm: 1.5, spaceBelowEm: 0.75 }),
    },
    chapterOpening: { startOn: "recto", sinkEm: 8, label: null },
    blockQuote: { indentEm: 1.5, sizeEm: 0.95, italic: false, ruleLeft: false, spaceEm: 0.8 },
    sceneBreak: { glyph: "*   *   *", spaceEm: 1 },
    runningText: { sizePt: 9, smallCaps: true, italic: false },
    footnoteSizeEm: 0.85,
    defaults: { trimSize: "5.5x8.5", marginsIn: { top: 0.8, bottom: 0.9, inside: 0.9, outside: 0.65 } },
  },
  epub: { css: NOVEL_CSS },
};

export const nonfiction: Template = {
  id: "nonfiction",
  name: "Nonfiction",
  description: "Spaced paragraphs, numbered chapter labels, bold left-aligned headings and set-off block quotes that work as callouts.",
  print: {
    bodyFonts: SERIF,
    headingFonts: [],
    fontSizePt: 11,
    leadingEm: 0.7,
    justify: false,
    hyphenate: false,
    paragraph: { style: "spaced", indentEm: 0, spacingEm: 0.9 },
    headings: {
      1: h({ sizeEm: 2, bold: true, spaceBelowEm: 1.4 }),
      2: h({ sizeEm: 1.35, bold: true, spaceAboveEm: 2, spaceBelowEm: 0.7 }),
      3: h({ sizeEm: 1.05, bold: true, italic: true, spaceAboveEm: 1.5, spaceBelowEm: 0.5 }),
    },
    chapterOpening: { startOn: "recto", sinkEm: 5, label: "Chapter {n}" },
    blockQuote: { indentEm: 1.2, sizeEm: 0.95, italic: false, ruleLeft: true, spaceEm: 1 },
    sceneBreak: { glyph: "⁂", spaceEm: 1 },
    runningText: { sizePt: 9, smallCaps: false, italic: true },
    footnoteSizeEm: 0.85,
    defaults: { trimSize: "6x9", marginsIn: { top: 0.85, bottom: 0.95, inside: 1, outside: 0.75 } },
  },
  epub: { css: NONFICTION_CSS },
};

export const modern: Template = {
  id: "modern",
  name: "Modern",
  description: "Minimal sans-serif layout: ragged-right text, light headings, generous whitespace.",
  print: {
    // First installed family wins and is reported; none installed means the export is refused.
    bodyFonts: ["Inter", "Helvetica Neue", "Helvetica", "Arial"],
    headingFonts: [],
    fontSizePt: 10.5,
    leadingEm: 0.75,
    justify: false,
    hyphenate: false,
    paragraph: { style: "spaced", indentEm: 0, spacingEm: 1 },
    headings: {
      1: h({ sizeEm: 2.1, bold: true, spaceBelowEm: 1.5 }),
      2: h({ sizeEm: 1.3, bold: true, spaceAboveEm: 2, spaceBelowEm: 0.7 }),
      3: h({ sizeEm: 1, bold: true, spaceAboveEm: 1.5, spaceBelowEm: 0.5 }),
    },
    chapterOpening: { startOn: "any", sinkEm: 6, label: null },
    blockQuote: { indentEm: 1.2, sizeEm: 1, italic: false, ruleLeft: true, spaceEm: 1 },
    sceneBreak: { glyph: "—", spaceEm: 1.2 },
    runningText: { sizePt: 8.5, smallCaps: false, italic: false },
    footnoteSizeEm: 0.85,
    defaults: { trimSize: "6x9", marginsIn: { top: 0.9, bottom: 1, inside: 1, outside: 0.8 } },
  },
  epub: { css: MODERN_CSS },
};

export const BUILTIN_TEMPLATES: readonly Template[] = [novel, nonfiction, modern];
