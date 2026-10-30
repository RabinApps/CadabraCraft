import { sourceEdition, sourceTitle } from "@cadabracraft/format";
import { plural, t } from "@lingui/core/macro";
import type { Manifest } from "@cadabracraft/format";
import { imageAltStats } from "@cadabracraft/export-epub";
import type { ChapterDoc } from "@cadabracraft/shared";

import type { Margins } from "./printEstimate";

export interface ExportCheck {
  tone: "ok" | "info" | "warn" | "error";
  text: string;
}

/** KDP paperback page limits (unverified, from memory of KDP's help pages). */
export const KDP_MIN_PAGES = 24;
export const KDP_MAX_PAGES = 828;
/** KDP's minimum outside, top and bottom margin in inches (no bleed). */
export const KDP_MIN_OUTER_IN = 0.25;
/** KDP's minimum outside, top and bottom margin in inches when the PDF has bleed. */
export const KDP_MIN_OUTER_BLEED_IN = 0.375;
/** The bleed KDP asks for, in inches (the Export dialog's "Add bleed"). */
export const KDP_BLEED_IN = 0.125;

/** KDP's minimum inside (gutter) margin in inches for a page count; null outside KDP's 24-828 range. */
export function kdpGutterMinIn(pages: number): number | null {
  if (pages < KDP_MIN_PAGES || pages > KDP_MAX_PAGES) return null;
  if (pages <= 150) return 0.375;
  if (pages <= 300) return 0.5;
  if (pages <= 500) return 0.625;
  if (pages <= 700) return 0.75;
  return 0.875;
}

export interface PdfCheckInput {
  /** Estimated page count (0 when the book has no text); it is an estimate, the Typst PDF is the reference. */
  estimatedPages: number;
  margins: Margins;
  /** True when the book has a cover image. */
  hasCover: boolean;
  /** The PDF will have bleed (raises the outer margin minimum). */
  bleed?: boolean;
  /** The PDF will have crop marks (KDP does not accept them). */
  cropMarks?: boolean;
}

/** KDP-style checks the Export dialog shows before a print PDF is built. Estimates only; KDP's own previewer decides. */
export function pdfChecks({
  estimatedPages,
  margins,
  hasCover,
  bleed = false,
  cropMarks = false,
}: PdfCheckInput): ExportCheck[] {
  const checks: ExportCheck[] = [];
  if (estimatedPages > 0) {
    if (estimatedPages < KDP_MIN_PAGES) {
      checks.push({
        tone: "error",
        text: t`Estimated ${estimatedPages} pages: KDP paperbacks need at least ${KDP_MIN_PAGES}. This is an estimate.`,
      });
    } else if (estimatedPages > KDP_MAX_PAGES) {
      checks.push({
        tone: "error",
        text: t`Estimated ${estimatedPages} pages: KDP paperbacks allow at most ${KDP_MAX_PAGES}. This is an estimate.`,
      });
    }
    const gutter = kdpGutterMinIn(estimatedPages);
    if (gutter !== null && margins.inside < gutter) {
      const inside = margins.inside;
      checks.push({
        tone: "warn",
        text: t`Inside margin ${inside} in is below KDP's ${gutter} in minimum for about ${estimatedPages} pages (estimate).`,
      });
    }
  }
  const outer = Math.min(margins.top, margins.bottom, margins.outside);
  if (bleed) {
    if (outer < KDP_MIN_OUTER_BLEED_IN)
      checks.push({
        tone: "warn",
        text: t`With bleed, KDP needs top, bottom and outside margins of at least ${KDP_MIN_OUTER_BLEED_IN} in.`,
      });
  } else if (outer < KDP_MIN_OUTER_IN) {
    checks.push({
      tone: "warn",
      text: t`Top, bottom and outside margins must be at least ${KDP_MIN_OUTER_IN} in for KDP.`,
    });
  }
  if (cropMarks)
    checks.push({
      tone: "info",
      text: t`Crop marks make the page larger than the trim size plus bleed. KDP does not accept them; use them only if your printer asks.`,
    });
  if (!hasCover)
    checks.push({
      tone: "info",
      text: t`This book has no cover image. KDP takes the cover as a separate file.`,
    });
  if (checks.length === 0) checks.push({ tone: "ok", text: t`No problems found` });
  return checks;
}

/** A page of the book as the checks see it: `file` names a page with no title. */
export interface CheckPage {
  title: string;
  file?: string;
  doc: ChapterDoc;
}

/** One warning per chapter with images that have no description and are not marked decorative. Used by every format that carries alt text. */
export function imageAltChecks(pages: CheckPage[]): ExportCheck[] {
  const checks: ExportCheck[] = [];
  for (const p of pages) {
    const missing = imageAltStats(p.doc).missingAlt;
    if (missing === 0) continue;
    const name = p.title.trim() || p.file || "";
    checks.push({
      tone: "warn",
      text: plural(missing, {
        one: `“${name}” has # image without alt text`,
        other: `“${name}” has # images without alt text`,
      }),
    });
  }
  return checks;
}

/** Checks the Export dialog shows before an EPUB is built. Only what the app can see; EPUBCheck is not run here. `pages` (every page's document) enables the image alt-text check. */
export function epubChecks(
  manifest: Manifest,
  pages: CheckPage[] = [],
  scope: { language?: string } = {},
): ExportCheck[] {
  const checks: ExportCheck[] = [];
  const language = scope.language ?? sourceEdition(manifest.editions).language;
  if (manifest.chapters.length === 0)
    checks.push({ tone: "warn", text: t`This book has no chapters yet.` });
  const untitled = manifest.chapters.filter(
    (c) => (c.titles[language] ?? sourceTitle(c, manifest.editions)).trim() === "",
  ).length;
  if (untitled > 0)
    checks.push({
      tone: "warn",
      text: plural(untitled, { one: "# chapter has no title", other: "# chapters have no title" }),
    });
  checks.push(...imageAltChecks(pages));
  if (checks.length === 0) checks.push({ tone: "ok", text: t`No problems found` });
  return checks;
}
