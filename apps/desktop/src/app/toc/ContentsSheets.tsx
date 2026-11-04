import type { CSSProperties } from "react";
import { useLingui } from "@lingui/react/macro";
import { cx } from "../../ui/cx";
import type { ContentsLayout, PreviewLine, PreviewPage } from "../../lib/tocPreview";

/**
 * The one drawing of a Contents page in the app. The editor's preview (when Typst cannot draw the page) and Read mode both render
 * through it: the book's trim size, the template's margins and type, the entries with their dot leaders and numbers, a book in a
 * right-to-left language mirrored. It only draws what it is given (`previewLines` from the rows the editor shows, `approxPages`
 * for where they fall); in Read mode `onOpen` turns each entry into a link.
 */

export interface ContentsData {
  title: string;
  /** The text follows the book's direction (the cards themselves are laid out left to right, like the print preview). */
  rtl: boolean;
  layout: ContentsLayout;
  pages: PreviewPage[];
  /** The book's body type is a serif face. */
  serif: boolean;
}

interface ListProps {
  lines: readonly PreviewLine[];
  entryPx: number;
  /** Given: each entry that has a page is a link that calls it. */
  onOpen?: (line: PreviewLine) => void;
}

/** The entries of a contents page: title, dot leader and number. A line without a page to go to (or with no `onOpen`) is plain text. */
export function ContentsEntries({ lines, entryPx, onOpen }: ListProps) {
  const { t } = useLingui();
  return (
    <ol className="m-0 flex list-none flex-col p-0" aria-label={t`Printed entries`}>
      {lines.map((line) => (
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
          {onOpen && line.entryId !== undefined ? (
            <a
              href={`#${line.entryId}`}
              data-contents-link={line.key}
              className="min-w-0 wrap-break-word text-inherit underline-offset-2 hover:underline focus-visible:underline"
              onClick={(e) => {
                e.preventDefault();
                onOpen(line);
              }}
            >
              {line.title}
            </a>
          ) : (
            <span className="min-w-0 wrap-break-word">{line.title}</span>
          )}
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
  );
}

interface SheetsProps extends ContentsData {
  /** Scale of a card (1 is 96 px per inch). */
  scale: number;
  /** The cards are dimmed while a newer preview is being made. */
  stale?: boolean;
  onOpen?: (line: PreviewLine) => void;
}

/** The contents page as cards at the trim size, scaled; a long list continues on further cards. They are siblings: the parent lays them out. */
export function ContentsSheets({
  title,
  rtl,
  layout,
  pages,
  serif,
  scale,
  stale,
  onOpen,
}: SheetsProps) {
  const { t } = useLingui();
  const { page, margins, fontPx, entryPx } = layout;
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
                <ContentsEntries lines={p.lines} entryPx={entryPx} onOpen={onOpen} />
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
