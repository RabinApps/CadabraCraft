import { useEffect, useState, type CSSProperties } from "react";
import { useLingui } from "@lingui/react/macro";
import type { Template } from "@cadabracraft/templates";
import { assetUrl } from "../../lib/assets";
import type { Margins } from "../../lib/printEstimate";

const CROP_GAP = 14;
const CORNERS = [
  "top-0 start-0 border-t border-s",
  "top-0 end-0 border-t border-e",
  "bottom-0 start-0 border-b border-s",
  "bottom-0 end-0 border-b border-e",
];

export interface ApproxPageProps {
  lines: string[];
  title?: string;
  template: Template;
  margins: Margins;
  /** Px per inch. */
  scale: number;
  /** Width of the page in px. */
  widthPx: number;
  heightPx: number;
  side: "left" | "right";
  showMargins: boolean;
  cropMarks: boolean;
  bodyFont: string;
  bleedPx: number;
}

/**
 * One page of the estimate shown when Typst cannot run: trim-sized paper with the template's type and margins, text clipped at the
 * bottom edge. The real preview (`TypstSpread`) replaces it whenever the PDF can be typeset.
 */
export function ApproxPage({
  lines,
  title,
  template,
  margins,
  scale,
  widthPx,
  heightPx,
  side,
  showMargins,
  cropMarks,
  bodyFont,
  bleedPx,
}: ApproxPageProps) {
  const outside = side === "left" ? margins.outside : margins.inside;
  const inside = side === "left" ? margins.inside : margins.outside;
  const style: CSSProperties = {
    width: widthPx,
    height: heightPx,
    fontFamily: bodyFont,
    fontSize: (template.print.fontSizePt * scale) / 72,
    lineHeight: 1 + template.print.leadingEm * 0.6,
    paddingTop: margins.top * scale,
    paddingBottom: margins.bottom * scale,
    paddingLeft: outside * scale,
    paddingRight: inside * scale,
  };
  return (
    <div className="relative" style={cropMarks ? { padding: CROP_GAP } : undefined}>
      <div className="relative overflow-hidden bg-paper text-ink shadow-page" style={style}>
        {title && (
          <p className="font-book font-semibold" style={{ fontSize: "1.4em", marginBottom: "1em" }}>
            {title}
          </p>
        )}
        {lines.map((line, i) => (
          <p
            key={i}
            style={{
              margin: "0 0 0.6em",
              textIndent: template.print.paragraph.style === "indent" ? "1.4em" : 0,
            }}
          >
            {line}
          </p>
        ))}
        {showMargins && (
          <div
            aria-hidden
            className="pointer-events-none absolute border border-dashed border-accent/60"
            style={{
              top: margins.top * scale,
              bottom: margins.bottom * scale,
              left: outside * scale,
              right: inside * scale,
            }}
          />
        )}
      </div>
      {bleedPx > 0 && (
        <div
          aria-hidden
          className="pointer-events-none absolute border border-dashed border-danger/60"
          style={{ inset: -bleedPx }}
        />
      )}
      {cropMarks &&
        CORNERS.map((c) => (
          <span
            key={c}
            aria-hidden
            className={`pointer-events-none absolute size-2.5 border-ink ${c}`}
          />
        ))}
    </div>
  );
}

/** The book's cover as it opens the PDF: a thumbnail the size of a trim-sized page. Nothing is shown when the image cannot be read. */
export function CoverThumb({ root, cover }: { root: string; cover: string }) {
  const { t } = useLingui();
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    setUrl(null);
    assetUrl(root, cover).then(
      (u) => {
        if (live) setUrl(u);
      },
      () => {},
    );
    return () => {
      live = false;
    };
  }, [root, cover]);
  if (!url) return null;
  return (
    <figure className="flex flex-col items-center gap-1.5">
      <img
        src={url}
        alt={t`Cover`}
        className="h-28 w-21 rounded-sm border border-border object-cover"
      />
      <figcaption className="text-xs text-ink-muted">{t`Cover`}</figcaption>
    </figure>
  );
}
