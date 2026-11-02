import { useRef, type CSSProperties } from "react";
import { useLingui } from "@lingui/react/macro";
import { Loader2 } from "lucide-react";
import { Button } from "../../ui/Button";
import { Notice } from "../../ui/Notice";
import { cx } from "../../ui/cx";
import {
  cardScale,
  PREVIEW_GAP_PX,
  PREVIEW_PAD_PX,
  type ContentsLayout,
  type PreviewLine,
} from "../../lib/tocPreview";
import { PX_PER_INCH } from "../../lib/pageLayout";
import { usePaneWidth } from "../hooks/usePaneWidth";
import { PdfPage, usePdfDocument } from "../export/TypstSpread";
import type { ApproxResult, TocPreviewState } from "./useTocPreview";

const noop = () => {};

/** The skeleton of a contents page, shown until the first preview is made. */
function Skeleton({ width, height }: { width: number; height: number }) {
  return (
    <div
      aria-hidden
      data-testid="toc-preview-skeleton"
      className="flex shrink-0 flex-col items-center gap-3 rounded-sm border border-border bg-paper px-8 pt-12 shadow-page"
      style={{ width, height }}
    >
      <span className="h-3 w-1/3 animate-pulse rounded-full bg-border-strong motion-reduce:animate-none" />
      {[88, 72, 80, 64, 76, 70].map((w, i) => (
        <span
          key={i}
          className="h-2 animate-pulse self-start rounded-full bg-border motion-reduce:animate-none"
          style={{ width: `${w}%` }}
        />
      ))}
    </div>
  );
}

interface ApproxProps {
  result: ApproxResult;
  scale: number;
  serif: boolean;
  stale: boolean;
}

/** The approximate contents pages: HTML at the trim size, scaled to the pane. The cards are laid out left to right like the print preview's pages; the text inside follows the book's direction. */
function ApproxPages({ result, scale, serif, stale }: ApproxProps) {
  const { t } = useLingui();
  const { pages, title, rtl } = result;
  const { page, margins, fontPx, entryPx } = result.layout;
  const total = pages.length;
  return (
    <>
      {pages.map((p) => {
        const recto = p.index % 2 === 0;
        const sheet: CSSProperties = {
          width: page.w,
          height: page.h,
          transform: `scale(${scale})`,
          transformOrigin: "0 0",
        };
        const text: CSSProperties = {
          fontSize: fontPx,
          fontFamily: serif ? "var(--font-book)" : "var(--font-ui)",
          paddingTop: margins.top,
          paddingBottom: margins.bottom,
          paddingInlineStart: recto ? margins.inside : margins.outside,
          paddingInlineEnd: recto ? margins.outside : margins.inside,
        };
        return (
          <div
            key={p.index}
            dir="ltr"
            data-testid="toc-preview-page"
            role="group"
            aria-label={t`Page ${p.index + 1} of ${total}`}
            className={cx(
              "relative shrink-0 rounded-sm border border-border bg-paper text-ink shadow-page transition-opacity",
              stale && "opacity-50",
            )}
            style={{ width: page.w * scale, height: page.h * scale }}
          >
            <div className="absolute top-0 start-0 overflow-hidden" style={sheet}>
              <div
                dir={rtl ? "rtl" : "ltr"}
                className="relative flex size-full flex-col overflow-hidden"
                style={text}
              >
                {p.index === 0 && (
                  <p
                    className="font-book text-center font-semibold"
                    style={{ fontSize: "1.6em", margin: `${fontPx * 3}px 0 ${fontPx * 1.5}px` }}
                  >
                    {title}
                  </p>
                )}
                <ol className="m-0 flex list-none flex-col p-0" aria-label={t`Printed entries`}>
                  {p.lines.map((line) => (
                    <li
                      key={line.key}
                      data-preview-line={line.key}
                      className={cx("flex items-baseline", line.bold ? "font-bold" : "font-normal")}
                      style={{
                        paddingInlineStart: line.level * 16,
                        minHeight: entryPx,
                        fontSize: line.level > 0 ? "0.92em" : undefined,
                      }}
                    >
                      <span className="min-w-0 wrap-break-word">{line.title}</span>
                      {line.number !== null && (
                        <>
                          <span
                            aria-hidden
                            data-leader
                            className="mx-1.5 min-w-4 flex-1 translate-y-[-0.2em] self-end border-b-2 border-dotted border-ink-muted"
                          />
                          <span className="shrink-0 tabular-nums" data-number>
                            {line.number}
                          </span>
                        </>
                      )}
                    </li>
                  ))}
                </ol>
                {p.folio && (
                  <span
                    data-folio
                    className="absolute inset-x-0 text-center text-ink-muted"
                    style={{ bottom: margins.bottom * 0.4 }}
                  >
                    {p.folio}
                  </span>
                )}
              </div>
            </div>
          </div>
        );
      })}
    </>
  );
}

interface TypstProps {
  pdf: Uint8Array;
  first: number;
  last: number;
  pxPerIn: number;
  stale: boolean;
}

/** The pages of Typst's PDF that hold the contents page, drawn by pdf.js. */
function TypstPages({ pdf, first, last, pxPerIn, stale }: TypstProps) {
  const { doc, error } = usePdfDocument(pdf, noop);
  const { t } = useLingui();
  if (error) return <Notice role="alert">{t`Could not show the preview: ${error}`}</Notice>;
  if (!doc) return null;
  return (
    <>
      {Array.from({ length: last - first + 1 }, (_, i) => first + i).map((n) => (
        <PdfPage key={n} doc={doc} page={n} outline={null} stale={stale} pxPerIn={pxPerIn} />
      ))}
    </>
  );
}

interface Props {
  state: TocPreviewState;
  /** The printed entries, for the text a screen reader gets in place of Typst's pictures of the pages. */
  lines: PreviewLine[];
  /** The page size of the book, for the skeleton and the scale before the first result. */
  layout: ContentsLayout;
  serif: boolean;
}

/**
 * The right half of the Contents screen: the contents page(s) as printed, at the book's trim size, scaled to the pane. The header says
 * where the numbers come from and shows a spinner while a newer preview is being made; the last one stays on screen, dimmed, until it
 * arrives. The approximation draws from `approxPages` when Typst is missing.
 */
export function TocPreview({ state, lines, layout, serif }: Props) {
  const { t } = useLingui();
  const body = useRef<HTMLDivElement>(null);
  const paneW = usePaneWidth(body);
  const { status, result, fallback } = state;
  const busy = status === "loading";
  const scale = cardScale(paneW, layout.page.w);
  return (
    <section
      aria-label={t`Preview`}
      // Scrolls when large text leaves it too short for its header and message (WCAG 1.4.4): nothing is cut off.
      className="flex min-h-0 min-w-0 flex-1 flex-col overflow-x-hidden overflow-y-auto rounded-md border border-border bg-surface"
    >
      <header className="flex items-center justify-between gap-3 border-b border-border px-4 py-2.5">
        <h3 className="text-sm font-semibold">{t`Preview`}</h3>
        <div className="flex items-center gap-2 text-xs text-ink-muted" aria-live="polite">
          {busy && (
            <Loader2
              size={14}
              role="img"
              aria-label={t`Updating the preview`}
              data-testid="toc-preview-spinner"
              className="animate-spin text-accent motion-reduce:animate-none"
            />
          )}
          <span data-testid="toc-preview-status">
            {status === "error"
              ? t`Could not draw the preview`
              : fallback
                ? t`Approximate: Typst is not available`
                : result?.kind === "typst"
                  ? t`Exact pages from Typst`
                  : t`Making the preview…`}
          </span>
        </div>
      </header>
      {/* Focusable so a keyboard user can scroll the pages (nothing inside it takes focus). */}
      <div
        ref={body}
        // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex
        tabIndex={0}
        role="group"
        aria-label={t`Pages`}
        data-testid="toc-preview-scroll"
        className="flex min-h-0 flex-1 flex-col items-center overflow-y-auto bg-bg"
        style={{ padding: PREVIEW_PAD_PX, gap: PREVIEW_GAP_PX }}
      >
        {fallback && (
          <Notice tone="accent" className="w-full" data-testid="toc-preview-fallback">
            {t`Typst is not installed on this computer, so this is an approximation: the layout is drawn by the app and page numbers marked ≈ are estimates. Install Typst to see the exact page.`}
          </Notice>
        )}
        {status === "error" && (
          <Notice role="alert" className="flex w-full flex-wrap items-center gap-3">
            <span className="min-w-0 flex-1 wrap-break-word">
              {t`Could not draw the preview`}
              {state.error ? `: ${state.error}` : ""}
            </span>
            <Button size="sm" onClick={state.retry}>
              {t`Retry`}
            </Button>
          </Notice>
        )}
        {result === null && status !== "error" && (
          <Skeleton width={layout.page.w * scale} height={layout.page.h * scale} />
        )}
        {result?.kind === "typst" && (
          <div dir="ltr" className="flex flex-col items-center" style={{ gap: PREVIEW_GAP_PX }}>
            <TypstPages
              pdf={result.pdf}
              first={result.first}
              last={result.last}
              pxPerIn={PX_PER_INCH * cardScale(paneW, result.trim.w * PX_PER_INCH)}
              stale={busy}
            />
          </div>
        )}
        {result?.kind === "typst" && (
          // The pages are canvases (pictures of text): the same entries as text, for assistive technology only.
          <ol className="sr-only" aria-label={t`Printed entries`}>
            {lines.map((line) => (
              <li key={line.key}>
                {line.title}
                {line.number !== null ? ` ${line.number}` : ""}
              </li>
            ))}
          </ol>
        )}
        {result?.kind === "approx" && (
          <ApproxPages result={result} scale={scale} serif={serif} stale={busy} />
        )}
      </div>
    </section>
  );
}
