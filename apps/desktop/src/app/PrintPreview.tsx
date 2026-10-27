import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { useLingui } from "@lingui/react/macro";
import { plural } from "@lingui/core/macro";
import { ArrowLeft, BookOpen, Printer } from "lucide-react";
import { TRIM_SIZES, type TrimSize } from "@cadabracraft/export-pdf";
import { DEFAULT_TEMPLATE_ID, getTemplate, hasTemplate, type Template } from "@cadabracraft/templates";
import { countWords } from "@cadabracraft/shared";
import { assetUrl } from "../lib/assets";
import { errText } from "../lib/projectError";
import { estimatePages, plainBlocks, wordsPerPage, type Margins } from "../lib/printPreview";
import { trimLabel } from "../lib/trimLabels";
import { Button, IconButton } from "../ui/Button";
import { Select } from "../ui/Select";
import { Switch } from "../ui/Switch";
import type { ExportFormat } from "./ExportDialog";
import { useProject, type BookPage } from "./store";

/** Width of one preview page in px. Height and everything inside are scaled from the trim size against it. */
const PAGE_PX = 300;
/** Blocks shown per page before the text is clipped. The real page breaks come from Typst. */
const BLOCKS_PER_PAGE = 7;
const CROP_GAP = 14;
const CORNERS = ["top-0 start-0 border-t border-s", "top-0 end-0 border-t border-e", "bottom-0 start-0 border-b border-s", "bottom-0 end-0 border-b border-e"];

interface PageProps {
  lines: string[];
  title?: string;
  template: Template;
  margins: Margins;
  scale: number;
  heightPx: number;
  side: "left" | "right";
  showMargins: boolean;
  cropMarks: boolean;
  bodyFont: string;
  bleedPx: number;
}

/** One preview page: trim-sized paper with the template's type and margins. Text is clipped at the bottom edge. */
function Page({ lines, title, template, margins, scale, heightPx, side, showMargins, cropMarks, bodyFont, bleedPx }: PageProps) {
  const outside = side === "left" ? margins.outside : margins.inside;
  const inside = side === "left" ? margins.inside : margins.outside;
  const style: CSSProperties = {
    width: PAGE_PX,
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
      <div className="relative overflow-hidden bg-paper text-ink shadow-md" style={style}>
        {title && <p className="font-book font-semibold" style={{ fontSize: "1.4em", marginBottom: "1em" }}>{title}</p>}
        {lines.map((line, i) => (
          <p key={i} style={{ margin: "0 0 0.6em", textIndent: template.print.paragraph.style === "indent" ? "1.4em" : 0 }}>{line}</p>
        ))}
        {showMargins && (
          <div aria-hidden className="pointer-events-none absolute border border-dashed border-accent/60" style={{ top: margins.top * scale, bottom: margins.bottom * scale, left: outside * scale, right: inside * scale }} />
        )}
      </div>
      {bleedPx > 0 && <div aria-hidden className="pointer-events-none absolute border border-dashed border-danger/60" style={{ inset: -bleedPx }} />}
      {cropMarks && CORNERS.map((c) => <span key={c} aria-hidden className={`pointer-events-none absolute size-[10px] border-ink ${c}`} />)}
    </div>
  );
}

/** The book's cover as it opens the PDF: a thumbnail the size of a trim-sized page. Nothing is shown when the image cannot be read. */
function CoverThumb({ root, cover }: { root: string; cover: string }) {
  const { t } = useLingui();
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    setUrl(null);
    assetUrl(root, cover).then((u) => { if (live) setUrl(u); }, () => {});
    return () => { live = false; };
  }, [root, cover]);
  if (!url) return null;
  return (
    <figure className="flex flex-col items-center gap-1.5">
      <img src={url} alt={t`Cover`} className="h-[112px] w-[84px] rounded-sm border border-border object-cover" />
      <figcaption className="text-xs text-ink-muted">{t`Cover`}</figcaption>
    </figure>
  );
}

interface Props {
  onBack: () => void;
  onExport: (format: ExportFormat) => void;
}

/** Approximate print preview: the page size, margins and type come from the template; the text is a rough flow. */
export function PrintPreview({ onBack, onExport }: Props) {
  const { t } = useLingui();
  const manifest = useProject((s) => s.manifest);
  const root = useProject((s) => s.root);
  const readPages = useProject((s) => s.actions.readPages);
  const [pages, setPages] = useState<BookPage[] | null>(null);
  const [error, setError] = useState("");
  const [bleed, setBleed] = useState<"none" | "3mm">("none");
  const [showMargins, setShowMargins] = useState(true);
  const [cropMarks, setCropMarks] = useState(false);
  const template = getTemplate(manifest && hasTemplate(manifest.template) ? manifest.template : DEFAULT_TEMPLATE_ID);
  const [trim, setTrim] = useState<TrimSize>(template.print.defaults.trimSize);
  useEffect(() => {
    readPages().then(setPages, (e: unknown) => setError(errText(e)));
  }, [readPages]);
  // Counting walks every page's document; only redo it when the pages are read again, not on each option change.
  const words = useMemo(() => (pages ?? []).reduce((sum, p) => sum + countWords(p.doc), 0), [pages]);

  if (!manifest) return null;
  const size = TRIM_SIZES[trim];
  const margins = template.print.defaults.marginsIn;
  const scale = PAGE_PX / size.w; // px per inch
  const heightPx = PAGE_PX * (size.h / size.w);
  const perPage = wordsPerPage(size, margins, template.print.fontSizePt);
  const estimate = estimatePages(words, manifest.chapters.length, perPage);
  const first = (pages ?? []).find((p) => p.section === "chapter") ?? pages?.[0];
  const blocks = first ? plainBlocks(first.doc).filter((b) => b !== first.title) : [];
  const bodyFont = /serif/i.test(template.print.bodyFonts[0] ?? "") ? "var(--font-book)" : "var(--font-ui)";
  const pageProps = { template, margins, scale, heightPx, showMargins, cropMarks, bodyFont, bleedPx: bleed === "3mm" ? (3 / 25.4) * scale : 0 };

  return (
    <div className="flex h-dvh flex-col bg-bg text-ink">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-surface px-4 py-2">
        <div className="flex min-w-0 items-center gap-3">
          <IconButton icon={ArrowLeft} label={t`Back`} onClick={onBack} />
          <h1 className="truncate font-book text-base font-semibold">{t`Print preview`}</h1>
        </div>
        <div className="flex items-center gap-2">
          <Button icon={BookOpen} onClick={() => onExport("epub")}>{t`Export EPUB`}</Button>
          <Button variant="primary" icon={Printer} onClick={() => onExport("pdf")}>{t`Export PDF`}</Button>
        </div>
      </header>
      {error && <p role="alert" className="m-4 rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}
      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <aside className="hidden w-[140px] shrink-0 flex-col items-center gap-3 overflow-y-auto bg-sidebar p-4 md:flex">
          {root && manifest.cover && <CoverThumb root={root} cover={manifest.cover} />}
          {(pages ?? []).slice(0, 6).map((p, i) => (
            <div key={p.id} className="flex flex-col items-center gap-1.5" aria-hidden>
              <div className="flex h-[112px] w-[84px] flex-col gap-1.5 rounded-sm border border-border bg-paper p-3">
                <span className="h-1.5 w-8 rounded-full bg-ink-muted" />
                {Array.from({ length: 5 }, (_, n) => <span key={n} className="h-px w-full bg-border" />)}
              </div>
              <span className="text-xs text-ink-muted">{i + 1}</span>
            </div>
          ))}
        </aside>
        <main className="flex min-h-0 min-w-0 flex-1 items-center justify-center overflow-auto p-6">
          <div className="flex flex-wrap items-start justify-center gap-6">
            <Page {...pageProps} side="left" title={first?.title} lines={blocks.slice(0, BLOCKS_PER_PAGE)} />
            <Page {...pageProps} side="right" lines={blocks.slice(BLOCKS_PER_PAGE, BLOCKS_PER_PAGE * 2)} />
          </div>
        </main>
        <aside className="flex w-full shrink-0 flex-col gap-5 overflow-y-auto border-t border-border bg-surface p-5 lg:w-[300px] lg:border-s lg:border-t-0">
          <h2 className="font-book text-lg font-semibold">{t`Page setup`}</h2>
          <Select label={t`Trim size`} value={trim} onChange={(e) => setTrim(e.target.value as TrimSize)}>
            {(Object.keys(TRIM_SIZES) as TrimSize[]).map((id) => <option key={id} value={id}>{trimLabel(id)}</option>)}
          </Select>
          <Select label={t`Bleed`} value={bleed} onChange={(e) => setBleed(e.target.value as "none" | "3mm")} hint={t`Shown in this preview only. The PDF does not include bleed or crop marks yet.`}>
            <option value="none">{t`None`}</option>
            <option value="3mm">{t`3 mm`}</option>
          </Select>
          <div className="flex flex-col gap-1">
            <span className="text-xs font-semibold text-ink-muted">{t`Pages`}</span>
            <span className="text-sm font-medium">{estimate === 0 ? t`No text yet` : plural(estimate, { one: "About # page", other: "About # pages" })}</span>
          </div>
          {manifest.cover && (
            <div className="flex flex-col gap-1">
              <span className="text-xs font-semibold text-ink-muted">{t`Cover`}</span>
              <span className="text-sm">{t`Added as the first page, with a blank page behind it, unless you turn it off in the export dialog. The page count above does not include them.`}</span>
            </div>
          )}
          <div className="flex items-center justify-between gap-3 text-sm">
            <span>{t`Show margins`}</span>
            <Switch label={t`Show margins`} checked={showMargins} onChange={setShowMargins} />
          </div>
          <div className="flex items-center justify-between gap-3 text-sm">
            <span>{t`Crop marks`}</span>
            <Switch label={t`Crop marks`} checked={cropMarks} onChange={setCropMarks} />
          </div>
        </aside>
      </div>
    </div>
  );
}
