import { PdfExportError } from "../errors";
import type { PdfMargins, PdfOptions } from "../types";
import { inch } from "./units";

/** Space outside the bleed that holds the crop marks, in inches. */
export const CROP_SLUG_IN = 0.25;
/** The largest bleed accepted, in inches. */
export const MAX_BLEED_IN = 0.5;

export interface PageGeometry {
  /** Page size in inches, trim plus bleed and slug. */
  width: number;
  height: number;
  /** The Typst `margin:` argument, measured so that the text sits where it would on the trimmed page. */
  margin: string;
  /** The Typst `foreground:` argument that draws the crop marks, or null. */
  foreground: string | null;
}

/** Validate the bleed options; returns the bleed and whether crop marks are drawn. */
export function bleedOf(options: PdfOptions): { bleed: number; marks: boolean } {
  const bleed = options.bleedIn ?? 0;
  if (!Number.isFinite(bleed) || bleed < 0 || bleed > MAX_BLEED_IN)
    throw new PdfExportError(
      `Invalid bleed: ${String(options.bleedIn)} (use 0 to ${MAX_BLEED_IN} in)`,
    );
  const marks = options.cropMarks === true;
  if (marks && bleed === 0) throw new PdfExportError("Crop marks need a bleed greater than 0");
  return { bleed, marks };
}

/**
 * Page size and margins for a trim size with bleed and crop marks. Margins are always from the trim edge, so the extra space is
 * added to the outer margins:
 * - bleed only: top, bottom and outside grow (the gutter edge is bound, so it has no bleed); with unmirrored margins both sides grow.
 * - with crop marks: the bleed plus the slug is added on all four sides, so the marks sit the same on every page.
 * Crop marks are 0.25 pt black lines in the slug, ending one bleed away from the trim corner.
 */
export function pageGeometry(
  trim: { w: number; h: number },
  margins: PdfMargins,
  mirrored: boolean,
  options: PdfOptions,
): PageGeometry {
  const { bleed, marks } = bleedOf(options);
  const slug = marks ? CROP_SLUG_IN : 0;
  const outer = bleed + slug;
  const inner = marks || !mirrored ? outer : 0;
  const m = (n: number): string => inch(n);
  const margin = mirrored
    ? `(top: ${m(margins.top + outer)}, bottom: ${m(margins.bottom + outer)}, inside: ${m(margins.inside + inner)}, outside: ${m(margins.outside + outer)})`
    : `(top: ${m(margins.top + outer)}, bottom: ${m(margins.bottom + outer)}, left: ${m(margins.inside + inner)}, right: ${m(margins.outside + outer)})`;
  const width = trim.w + inner + outer;
  const height = trim.h + 2 * outer;
  return {
    width,
    height,
    margin,
    foreground: marks ? cropMarks(width, height, outer, slug) : null,
  };
}

function cropMarks(w: number, h: number, edge: number, len: number): string {
  const line = (x: number, y: number, dx: number, dy: number): string =>
    `place(top + left, dx: ${inch(x)}, dy: ${inch(y)}, line(start: (0pt, 0pt), end: (${inch(dx)}, ${inch(dy)}), stroke: 0.25pt + black))`;
  const lines = [
    ...[edge, w - edge].flatMap((x) => [line(x, 0, 0, len), line(x, h - len, 0, len)]),
    ...[edge, h - edge].flatMap((y) => [line(0, y, len, 0), line(w - len, y, len, 0)]),
  ];
  return `{\n    ${lines.join("\n    ")}\n  }`;
}
