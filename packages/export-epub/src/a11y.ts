import { esc } from "./xhtml";

/** What the book contains, as far as accessibility metadata is concerned. */
export interface A11yFacts {
  /** Images in chapters (the cover is counted separately). */
  images: number;
  /** Chapter images with empty or missing alt text. */
  imagesMissingAlt: number;
  /** True when a cover page is written; its image always has alt text. */
  hasCover: boolean;
  /** True when a chapter image is a GIF, which may animate or flash and cannot be checked. */
  hasGif: boolean;
  /** True when a chapter image is an SVG, which can animate (SMIL, CSS) and is not inspected for motion. */
  hasSvg: boolean;
}

/**
 * Schema.org accessibility metadata for the OPF (the EPUB Accessibility 1.1 discovery metadata; schema is a reserved
 * prefix, so no prefix attribute is needed). It lists only what this exporter really delivers: a navigation document
 * with a table of contents, a linear reading order and, for alternative text, only a book whose every image has alt text.
 * No `dcterms:conformsTo` or `a11y:certifiedBy`: conformance to WCAG or EPUB Accessibility needs an evaluation we do not make.
 */
export function accessibilityMetadata(f: A11yFacts): string {
  const visual = f.images > 0 || f.hasCover;
  const allAlt = f.imagesMissingAlt === 0;
  const features = [
    "tableOfContents",
    "readingOrder",
    "structuralNavigation",
    // The stylesheet sets no fixed font sizes, colours or layout that blocks resizing (tested), so readers can restyle the text.
    "displayTransformability",
    ...(visual && allAlt ? ["alternativeText"] : []),
  ];
  const summary = [
    "This publication is reflowable text with a table of contents and a linear reading order.",
    visual
      ? allAlt
        ? "Every image has alternative text."
        : "Some images have no alternative text."
      : "It has no images.",
    "Its accessibility has not been formally evaluated against a standard.",
  ].join(" ");
  const meta = (property: string, value: string, attrs = "") =>
    `<meta property="schema:${property}"${attrs}>${esc(value)}</meta>`;
  return [
    meta("accessMode", "textual"),
    ...(visual ? [meta("accessMode", "visual")] : []),
    meta("accessModeSufficient", visual && !allAlt ? "textual,visual" : "textual"),
    ...features.map((x) => meta("accessibilityFeature", x)),
    meta("accessibilityHazard", f.hasGif || f.hasSvg ? "unknown" : "none"),
    meta("accessibilitySummary", summary, ' xml:lang="en"'),
  ].join("");
}
