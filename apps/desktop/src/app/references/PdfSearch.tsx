import { useRef, useState, type FormEvent } from "react";
import { useLingui } from "@lingui/react/macro";
import { ChevronDown, ChevronUp, Search, X } from "lucide-react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { matchPages } from "../../lib/pdfSearch";
import { IconButton } from "../../ui/Button";

/** The text of every page, read once per document. */
async function pageTexts(doc: PDFDocumentProxy): Promise<string[]> {
  const texts: string[] = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const content = await (await doc.getPage(n)).getTextContent();
    texts.push(content.items.map((i) => ("str" in i ? i.str : "")).join(" "));
  }
  return texts;
}

/** Search in a PDF: finds the pages that contain the text and steps between them. Shows no highlight on the page. */
export function PdfSearch({
  doc,
  onGo,
}: {
  doc: PDFDocumentProxy | null;
  onGo: (page: number) => void;
}) {
  const { t } = useLingui();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<number[] | null>(null);
  const [at, setAt] = useState(0);
  const texts = useRef<string[] | null>(null);
  const go = (i: number) => {
    setAt(i);
    onGo(hits![i]!);
  };
  const search = async (e: FormEvent) => {
    e.preventDefault();
    texts.current ??= await pageTexts(doc!);
    const found = matchPages(texts.current, query);
    setHits(found);
    setAt(0);
    if (found.length > 0 && found[0]) onGo(found[0]);
  };
  const close = () => {
    setOpen(false);
    setHits(null);
    setQuery("");
  };
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
            className="h-8 w-44 rounded-md border border-border bg-paper px-2 text-sm"
          />
          <span className="min-w-20 text-sm text-ink-muted" role="status">
            {hits === null
              ? ""
              : hits.length
                ? t`Page ${hits[at]!}, ${at + 1} of ${hits.length}`
                : t`No matches`}
          </span>
          <IconButton
            icon={ChevronUp}
            label={t`Previous match`}
            disabled={!hits || at <= 0}
            onClick={() => go(at - 1)}
          />
          <IconButton
            icon={ChevronDown}
            label={t`Next match`}
            disabled={!hits || at >= hits.length - 1}
            onClick={() => go(at + 1)}
          />
          <IconButton icon={X} label={t`Close search`} onClick={close} />
        </form>
      )}
    </>
  );
}
