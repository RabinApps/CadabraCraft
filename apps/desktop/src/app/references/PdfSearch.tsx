import { useRef, useState, type FormEvent } from "react";
import { useLingui } from "@lingui/react/macro";
import { ChevronDown, ChevronUp, Search, X } from "lucide-react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { countsByPage, findMatches, type PdfMatch, type PdfTextItem } from "../../lib/pdfSearch";
import { IconButton } from "../../ui/Button";

/** The text items of every page, read once per document. */
async function pageItems(doc: PDFDocumentProxy): Promise<PdfTextItem[][]> {
  const pages: PdfTextItem[][] = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const content = await (await doc.getPage(n)).getTextContent();
    pages.push(
      content.items.flatMap((i) =>
        "str" in i
          ? [{ str: i.str, x: i.transform[4], y: i.transform[5], width: i.width, height: i.height }]
          : [],
      ),
    );
  }
  return pages;
}

/** What the viewer draws: every match and the one in focus (an index into `matches`). */
export type PdfHits = { matches: PdfMatch[]; at: number };

/** Search in a PDF: finds every match, steps through them page by page and reports them for highlighting. */
export function PdfSearch({
  doc,
  onGo,
  onHits,
}: {
  doc: PDFDocumentProxy | null;
  onGo: (page: number) => void;
  onHits: (hits: PdfHits | null) => void;
}) {
  const { t } = useLingui();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<PdfHits | null>(null);
  const items = useRef<PdfTextItem[][] | null>(null);
  const searched = useRef("");
  const show = (next: PdfHits | null) => {
    setHits(next);
    onHits(next);
    const match = next?.matches[next.at];
    if (match) onGo(match.page);
  };
  const go = (at: number) => hits && show({ matches: hits.matches, at });
  const search = async (e: FormEvent) => {
    e.preventDefault();
    // Enter again on the same text steps to the next match, wrapping round.
    if (hits && hits.matches.length > 0 && query === searched.current) {
      return go((hits.at + 1) % hits.matches.length);
    }
    items.current ??= await pageItems(doc!);
    searched.current = query;
    show({ matches: findMatches(items.current, query), at: 0 });
  };
  const close = () => {
    setOpen(false);
    setQuery("");
    searched.current = "";
    show(null);
  };
  const total = hits?.matches.length ?? 0;
  const current = hits?.matches[hits.at];
  const onPage = current ? (countsByPage(hits!.matches).get(current.page) ?? 0) : 0;
  return (
    <>
      <span className="w-4" />
      <IconButton
        icon={Search}
        label={t`Search in PDF`}
        disabled={!doc}
        active={open}
        onClick={() => (open ? close() : setOpen(true))}
      />
      {open && (
        <form onSubmit={search} role="search" className="flex items-center gap-1">
          <input
            autoFocus
            value={query}
            aria-label={t`Search text`}
            placeholder={t`Find in this PDF`}
            onChange={(e) => setQuery(e.target.value)}
            className="h-8 w-44 rounded-md border border-border-strong bg-paper px-2 text-sm"
          />
          <span className="min-w-20 text-sm text-ink-muted" role="status">
            {hits === null
              ? ""
              : current
                ? t`Match ${hits.at + 1} of ${total}, page ${current.page} (${onPage} on this page)`
                : t`No matches`}
          </span>
          <IconButton
            icon={ChevronUp}
            label={t`Previous match`}
            disabled={!hits || hits.at <= 0}
            onClick={() => go(hits!.at - 1)}
          />
          <IconButton
            icon={ChevronDown}
            label={t`Next match`}
            disabled={!hits || hits.at >= total - 1}
            onClick={() => go(hits!.at + 1)}
          />
          <IconButton icon={X} label={t`Close search`} onClick={close} />
        </form>
      )}
    </>
  );
}
