import { useEffect, useState } from "react";
import { exportDir, sourceEdition } from "@cadabracraft/format";
import { useLingui } from "@lingui/react/macro";
import { FileText, Printer } from "lucide-react";
import type { ManuscriptFont as DocxFont } from "@cadabracraft/export-docx";
import { PdfUiError } from "../../lib/pdfErrors";
import { errText } from "../../lib/projectError";
import { Button } from "../../ui/Button";
import { Modal } from "../../ui/Dialog";
import { Segmented } from "../../ui/Segmented";
import { useSponsor } from "../../state/sponsor";
import { useProject } from "../../state/project";
import { AudioFooter } from "./AudioFooter";
import { AudioPanel } from "./AudioPanel";
import { DocxPanel } from "./DocxPanel";
import { EditionsChecklist, untranslatedIn } from "./EditionsChecklist";
import { nativeName } from "../shell/EditionSwitcher";
import { EpubPanel } from "./EpubPanel";
import { MarkdownPanel } from "./MarkdownPanel";
import { PdfPanel, saveTypstPath, usePdfOptions } from "./PdfPanel";
import { useAudioExport } from "./useAudioExport";
import type { ExportFormat } from "./exportFormat";
import { Notice } from "../../ui/Notice";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  format: ExportFormat;
  onFormatChange: (f: ExportFormat) => void;
  /** Opens the print preview, which has the page setup. Omitted when the dialog is already in the preview. */
  onPreview?: () => void;
}

/** Export the book as EPUB 3, a print PDF (Typst), Markdown, Word or an audiobook. Each format's panel shows its checks or options before building. */
export function ExportDialog({ open, onOpenChange, format, onFormatChange, onPreview }: Props) {
  const { t } = useLingui();
  const manifest = useProject((s) => s.manifest);
  const stage = useProject((s) => s.exportStage);
  const exportEpub = useProject((s) => s.actions.exportEpub);
  const exportMarkdown = useProject((s) => s.actions.exportMarkdown);
  const exportDocx = useProject((s) => s.actions.exportDocx);
  const exportPdf = useProject((s) => s.actions.exportPdf);
  const activeLanguage = useProject((s) => s.activeLanguage);
  const [htmlMarks, setHtmlMarks] = useState(false);
  const [font, setFont] = useState<DocxFont>("times");
  const [error, setError] = useState<PdfUiError | null>(null);
  const current = activeLanguage ?? (manifest ? sourceEdition(manifest.editions).language : "");
  // The editions to export (the open one until the author picks others) and the ones whose untranslated pages are left out.
  const [picked, setPicked] = useState<string[]>([]);
  const [skipped, setSkipped] = useState<string[]>([]);
  const [exporting, setExporting] = useState<string | null>(null);
  useEffect(() => {
    if (open) {
      setPicked(current ? [current] : []);
      setSkipped([]);
    }
    // Reset only when the dialog opens.
  }, [open]);
  const many = !!manifest && manifest.editions.length > 1;
  // The checks and the page estimate follow the first picked edition.
  const language = picked[0] ?? current;
  const scopeOf = (l: string) => ({ language: l, skipUntranslated: skipped.includes(l) });
  const scope = scopeOf(language);
  const dir = exportDir(exporting ?? language);
  const blocked = manifest
    ? picked.find((l) => untranslatedIn(manifest, l).length > 0 && !skipped.includes(l))
    : undefined;
  const nothingPicked = many && picked.length === 0;
  const pdf = usePdfOptions(manifest);
  const audio = useAudioExport({ active: open && format === "audiobook", setError });
  const running = stage !== null;
  const stageText =
    format === "epub"
      ? {
          preparing: t`Reading your chapters…`,
          rendering: t`Building EPUB…`,
          saving: t`Saving ${dir}/book.epub…`,
        }
      : format === "markdown"
        ? {
            preparing: t`Reading your chapters…`,
            rendering: t`Writing Markdown…`,
            saving: t`Saving ${dir}/book.md…`,
          }
        : format === "docx"
          ? {
              preparing: t`Reading your chapters…`,
              rendering: t`Writing the Word file…`,
              saving: t`Saving ${dir}/manuscript.docx…`,
            }
          : {
              preparing: t`Reading your chapters…`,
              rendering: t`Typesetting the book with Typst…`,
              saving: t`Saving ${dir}/book.pdf…`,
            };

  const change = (o: boolean) => {
    if (running) return; // an export cannot be cancelled; keep the dialog until it ends
    if (!o) {
      setError(null);
      pdf.setTemplate(null);
      audio.reset(format === "audiobook");
    }
    onOpenChange(o);
  };
  const submit = async () => {
    setError(null);
    try {
      if (format === "audiobook") return audio.submit();
      if (format === "pdf") saveTypstPath(pdf.typstPath.trim());
      const languages = picked.length ? picked : [current];
      // One edition after the other; the first failure stops the rest and is shown.
      for (const l of languages) {
        setExporting(l);
        const s = scopeOf(l);
        if (format === "epub") await exportEpub(s);
        else if (format === "markdown") await exportMarkdown({ htmlMarks, ...s });
        else if (format === "docx") await exportDocx({ font, ...s });
        else
          await exportPdf({
            trimSize: pdf.trimSize,
            pdfA: pdf.pdfA,
            cover: pdf.withCover,
            template: pdf.current,
            typstPath: pdf.typstPath.trim() || undefined,
            ...s,
          });
      }
      const last = exportDir(languages.at(-1)!);
      change(false);
      useSponsor
        .getState()
        .offer(
          format === "epub"
            ? `${last}/book.epub`
            : format === "markdown"
              ? `${last}/book.md`
              : format === "docx"
                ? `${last}/manuscript.docx`
                : `${last}/book.pdf`,
        );
    } catch (e) {
      setError(e instanceof PdfUiError ? e : new PdfUiError("other", errText(e)));
    } finally {
      setExporting(null);
    }
  };
  return (
    <Modal
      size="md"
      open={open}
      onOpenChange={change}
      title={t`Export book`}
      description={
        format === "audiobook"
          ? t`Makes one audio file per chapter with a voice that runs on your computer. Nothing is uploaded.`
          : format === "epub"
            ? t`Creates an EPUB 3 e-book in the exports folder.`
            : format === "markdown"
              ? t`Writes the whole book as one Markdown file in the exports folder, in reading order. Nothing else is needed on this computer.`
              : format === "docx"
                ? t`Writes the whole book as a Word file in standard manuscript format, in the exports folder: double spaced, 12 pt, 1 inch margins, a title page and a running header with your surname. Nothing else is needed on this computer.`
                : t`Creates a print-ready PDF in the exports folder. Typst, the PDF engine, comes with the app.`
      }
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <Segmented<ExportFormat>
          label={t`Format`}
          value={format}
          onChange={(f) => {
            setError(null);
            onFormatChange(f);
          }}
          items={[
            { value: "epub", label: t`EPUB 3` },
            { value: "pdf", label: t`Print PDF` },
            { value: "markdown", label: t`Markdown` },
            { value: "docx", label: t`Word (.docx)` },
            { value: "audiobook", label: t`Audiobook` },
          ]}
        />
        {format !== "audiobook" && many && manifest && (
          <EditionsChecklist
            manifest={manifest}
            current={current}
            picked={picked}
            skipped={skipped}
            onPicked={setPicked}
            onSkipped={setSkipped}
            disabled={running}
          />
        )}
        {format === "audiobook" ? (
          <AudioPanel audio={audio} />
        ) : format === "epub" ? (
          <EpubPanel {...scope} />
        ) : format === "docx" ? (
          <DocxPanel font={font} onFont={setFont} disabled={running} />
        ) : format === "markdown" ? (
          <MarkdownPanel htmlMarks={htmlMarks} onHtmlMarks={setHtmlMarks} disabled={running} />
        ) : (
          <PdfPanel options={pdf} running={running} error={error} {...scope} />
        )}
        {running && (
          <div className="flex flex-col gap-2">
            <p role="status" className="text-sm text-ink-muted">
              {stageText[stage]}
            </p>
            <div className="h-1.5 overflow-hidden rounded-full bg-border" aria-hidden>
              <div className="h-full w-1/3 animate-pulse rounded-full bg-accent motion-reduce:animate-none" />
            </div>
          </div>
        )}
        {error && (
          <Notice role="alert" className="whitespace-pre-wrap break-words">
            {error.message}
          </Notice>
        )}
        {format === "audiobook" ? (
          <AudioFooter
            audio={audio}
            onClose={() => change(false)}
            onKeepWorking={() => onOpenChange(false)}
          />
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-2.5">
            {onPreview && format !== "markdown" && format !== "docx" ? (
              <Button
                disabled={running}
                onClick={onPreview}
                icon={Printer}
              >{t`Print preview`}</Button>
            ) : (
              <span />
            )}
            <div className="flex items-center gap-2.5">
              {(blocked || nothingPicked) && !running && (
                <p role="status" className="text-sm text-danger">
                  {blocked
                    ? t`Choose how to handle ${nativeName(blocked)} to export it.`
                    : t`Pick an edition to export.`}
                </p>
              )}
              <Button disabled={running} onClick={() => change(false)}>{t`Cancel`}</Button>
              <Button
                type="submit"
                variant="primary"
                icon={FileText}
                disabled={running || !!blocked || nothingPicked}
              >
                {running ? t`Exporting…` : t`Export`}
              </Button>
            </div>
          </div>
        )}
      </form>
    </Modal>
  );
}
