import type { BookMetadata, ChapterDoc, MatterKind, Section } from "@cadabracraft/shared";
import type { Template, TrimSizeId } from "@cadabracraft/templates";

export type TrimSize = TrimSizeId;

/** Trim sizes in inches (width x height). */
export const TRIM_SIZES: Record<TrimSize, { w: number; h: number }> = {
  "4.25x6.87": { w: 4.25, h: 6.87 },
  "5x8": { w: 5, h: 8 },
  "5.25x8": { w: 5.25, h: 8 },
  "5.5x8.5": { w: 5.5, h: 8.5 },
  "6x9": { w: 6, h: 9 },
  "7x10": { w: 7, h: 10 },
  "8.5x11": { w: 8.5, h: 11 },
};

export type PdfBook = Pick<BookMetadata, "title" | "author" | "language">;

export interface PdfChapter {
  id: string;
  title: string;
  doc: ChapterDoc;
  /** Where the page sits in the book; default "chapter". Pass pages in reading order: front matter, chapters, back matter. */
  section?: Section;
  /** Front/back matter pages only. */
  kind?: MatterKind;
}

/** Margins in inches. `inside` is the gutter side when `mirrored`, else the left margin. */
export interface PdfMargins {
  top: number;
  bottom: number;
  inside: number;
  outside: number;
}

export interface PdfOptions {
  /** Template id (default `novel`) or a template object. */
  template?: string | Template;
  trimSize?: TrimSize;
  /** Defaults to the template's margins. */
  margins?: Partial<PdfMargins>;
  /** Inside/outside margins alternate on facing pages (default true). When false, inside = left, outside = right. */
  mirrored?: boolean;
  /** Page numbers in the footer (default true). */
  pageNumbers?: boolean;
  /** Book title on left pages, chapter title on right pages (default true). */
  runningHeaders?: boolean;
  /** Explicit font families. These are never substituted: a missing one fails the export. */
  fonts?: { body?: string; heading?: string };
  /** Body size in pt (default: template). */
  fontSizePt?: number;
  /** Override the template's chapter opening (recto = right-hand pages). */
  chapterStart?: "recto" | "any";
  /** Image bytes keyed by the image node's `src`. */
  assets?: Record<string, Uint8Array>;
  /** Key in `assets` of the cover image (png, jpg or webp). It becomes a full-bleed first page with no header or number, and page numbering restarts at 1 after it. */
  cover?: string;
  /** Emit PDF/A-2b (archival). */
  pdfA?: boolean;
  /**
   * Bleed in inches (0 to 0.5, default none): the page grows by this much past the trim on the top, bottom and outside edges
   * (KDP: 0.125 in). Margins stay measured from the trim, so the text does not move. A cover image fills the bleed.
   */
  bleedIn?: number;
  /**
   * Crop marks in the slug outside the bleed (needs `bleedIn` > 0). The page then grows by the bleed plus a 0.25 in slug on all
   * four sides, so it is no longer a KDP-style bleed file.
   */
  cropMarks?: boolean;
  /**
   * Put invisible marks in the source of every chapter: one at the start and end of each top-level block and one at each word of an
   * ordinary paragraph, and let the `<page-report>` carry the page each one landed on (`PageReport.blocks`). The marks take no room,
   * so the layout is the one without them; use it for `measurePages` only.
   */
  blockMarks?: boolean;
}

export interface FontChoice {
  body: string;
  heading: string;
}

export interface TypstDocument {
  source: string;
  /** Image node `src` -> relative path inside the compile directory. */
  images: Map<string, string>;
  fonts: FontChoice;
  /** The source imports the vendored drop cap package (`typst-droplet/`), which `renderPdf` writes next to it. */
  usesDropCap: boolean;
}

export interface RenderResult {
  pdf: Uint8Array;
  /** Font families the export used. */
  fonts: FontChoice;
}
