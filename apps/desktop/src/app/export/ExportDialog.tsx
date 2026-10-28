import { useState } from "react";
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
import { EpubPanel } from "./EpubPanel";
import { MarkdownPanel } from "./MarkdownPanel";
import { PdfPanel, saveTypstPath, usePdfOptions } from "./PdfPanel";
import { useAudioExport } from "./useAudioExport";
import type { ExportFormat } from "./exportFormat";

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
  const [htmlMarks, setHtmlMarks] = useState(false);
  const [font, setFont] = useState<DocxFont>("times");
  const [error, setError] = useState<PdfUiError | null>(null);
  const pdf = usePdfOptions(manifest);
  const audio = useAudioExport({ active: open && format === "audiobook", setError });
  const running = stage !== null;
  const stageText =
    format === "epub"
      ? {
          preparing: t`Reading your chapters…`,
          rendering: t`Building EPUB…`,
          saving: t`Saving exports/book.epub…`,
        }
      : format === "markdown"
        ? {
            preparing: t`Reading your chapters…`,
            rendering: t`Writing Markdown…`,
            saving: t`Saving exports/book.md…`,
          }
        : format === "docx"
          ? {
              preparing: t`Reading your chapters…`,
              rendering: t`Writing the Word file…`,
              saving: t`Saving exports/manuscript.docx…`,
            }
          : {
              preparing: t`Reading your chapters…`,
              rendering: t`Typesetting the book with Typst…`,
              saving: t`Saving exports/book.pdf…`,
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
      if (format === "epub") {
        await exportEpub();
      } else if (format === "markdown") {
        await exportMarkdown({ htmlMarks });
      } else if (format === "docx") {
        await exportDocx({ font });
      } else {
        saveTypstPath(pdf.typstPath.trim());
        await exportPdf({
          trimSize: pdf.trimSize,
          pdfA: pdf.pdfA,
          cover: pdf.withCover,
          template: pdf.current,
          typstPath: pdf.typstPath.trim() || undefined,
        });
      }
      change(false);
      useSponsor
        .getState()
        .offer(
          format === "epub"
            ? "exports/book.epub"
            : format === "markdown"
              ? "exports/book.md"
              : format === "docx"
                ? "exports/manuscript.docx"
                : "exports/book.pdf",
        );
    } catch (e) {
      setError(e instanceof PdfUiError ? e : new PdfUiError("other", errText(e)));
    }
  };
  return (
    <Modal
      md
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
        {format === "audiobook" ? (
          <AudioPanel audio={audio} />
        ) : format === "epub" ? (
          <EpubPanel />
        ) : format === "docx" ? (
          <DocxPanel font={font} onFont={setFont} disabled={running} />
        ) : format === "markdown" ? (
          <MarkdownPanel htmlMarks={htmlMarks} onHtmlMarks={setHtmlMarks} disabled={running} />
        ) : (
          <PdfPanel options={pdf} running={running} error={error} />
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
          <p
            role="alert"
            className="whitespace-pre-wrap break-words rounded-md bg-danger-soft px-3 py-2 text-sm text-danger"
          >
            {error.message}
          </p>
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
            <div className="flex gap-2.5">
              <Button disabled={running} onClick={() => change(false)}>{t`Cancel`}</Button>
              <Button type="submit" variant="primary" icon={FileText} disabled={running}>
                {running ? t`Exporting…` : t`Export`}
              </Button>
            </div>
          </div>
        )}
      </form>
    </Modal>
  );
}
