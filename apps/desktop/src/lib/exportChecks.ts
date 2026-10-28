import { sourceTitle } from "@cadabracraft/format";
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
}

/** KDP-style checks the Export dialog shows before a print PDF is built. Estimates only; KDP's own previewer decides. */
export function pdfChecks({ estimatedPages, margins, hasCover }: PdfCheckInput): ExportCheck[] {
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
  if (outer < KDP_MIN_OUTER_IN) {
    checks.push({
      tone: "warn",
      text: t`Top, bottom and outside margins must be at least ${KDP_MIN_OUTER_IN} in for KDP.`,
    });
  }
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

/** Checks the Export dialog shows before an EPUB is built. Only what the app can see; EPUBCheck is not run here. `pages` (every page's document) enables the image alt-text check. */
export function epubChecks(manifest: Manifest, pages: CheckPage[] = []): ExportCheck[] {
  const checks: ExportCheck[] = [];
  if (manifest.chapters.length === 0)
    checks.push({ tone: "warn", text: t`This book has no chapters yet.` });
  const untitled = manifest.chapters.filter(
    (c) => sourceTitle(c, manifest.editions).trim() === "",
  ).length;
  if (untitled > 0)
    checks.push({
      tone: "warn",
      text: plural(untitled, { one: "# chapter has no title", other: "# chapters have no title" }),
    });
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
  if (checks.length === 0) checks.push({ tone: "ok", text: t`No problems found` });
  return checks;
}
