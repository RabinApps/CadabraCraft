/** Template data. A template is plain data: no code, so it can be validated, diffed and shipped as JSON later. */

export type HeadingAlign = "left" | "center";

export interface PrintHeadingStyle {
  /** Font size as a multiple of the body size. */
  sizeEm: number;
  bold: boolean;
  italic: boolean;
  smallCaps: boolean;
  align: HeadingAlign;
  spaceAboveEm: number;
  spaceBelowEm: number;
}

export interface PrintChapterOpening {
  /** `recto` forces chapters onto right-hand pages (blank verso inserted when needed). */
  startOn: "recto" | "any";
  /** Blank space above the chapter title, in multiples of the body size. */
  sinkEm: number;
  /** Small label above the chapter title; `{n}` is the chapter number. `null` for none. */
  label: string | null;
}

export type TrimSizeId = "5x8" | "5.5x8.5" | "6x9";

/** Typst-oriented print settings. Lengths in pt or em as named; the exporter turns them into Typst. */
export interface PrintSettings {
  /** Preferred body font families, in order. The exporter uses the first one that is installed and reports which. */
  bodyFonts: string[];
  /** Heading font families; empty means "same as body". */
  headingFonts: string[];
  fontSizePt: number;
  /** Gap between lines (Typst `par.leading`), in em. */
  leadingEm: number;
  justify: boolean;
  hyphenate: boolean;
  paragraph: { style: "indent" | "spaced"; indentEm: number; spacingEm: number };
  headings: { 1: PrintHeadingStyle; 2: PrintHeadingStyle; 3: PrintHeadingStyle };
  chapterOpening: PrintChapterOpening;
  blockQuote: { indentEm: number; sizeEm: number; italic: boolean; ruleLeft: boolean; spaceEm: number };
  sceneBreak: { glyph: string; spaceEm: number };
  /** Running header and footer text. */
  runningText: { sizePt: number; smallCaps: boolean; italic: boolean };
  footnoteSizeEm: number;
  /** Defaults the app proposes for this template. */
  defaults: { trimSize: TrimSizeId; marginsIn: { top: number; bottom: number; inside: number; outside: number } };
}

export interface EpubSettings {
  /** Stylesheet for the EPUB (relative units only; readers apply their own font and size). */
  css: string;
}

export interface Template {
  id: string;
  name: string;
  description: string;
  print: PrintSettings;
  epub: EpubSettings;
}
