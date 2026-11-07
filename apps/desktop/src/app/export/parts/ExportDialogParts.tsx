import { useLingui } from "@lingui/react/macro";
import { FileText, Printer } from "lucide-react";
import type { ManuscriptFont } from "@cadabracraft/export-docx";
import type { OutlineFormat } from "@cadabracraft/outline";
import { Button } from "../../../ui/Button";
import { Segmented } from "../../../ui/forms/Segmented";
import { Notice } from "../../../ui/feedback/Notice";
import { nativeName } from "../../shell/header/EditionSwitcher";
import type { PdfUiError } from "../../../lib/export/pdfErrors";
import type { ExportScope } from "../../../state/project/types";
import { AudioFooter } from "../AudioFooter";
import { AltTextCheck } from "../AltTextCheck";
import { AudioPanel } from "../AudioPanel";
import { EpubPanel } from "../EpubPanel";
import type { ExportFormat } from "../exportFormat";
import { ManuscriptPanel } from "../ManuscriptPanel";
import { MarkdownPanel } from "../MarkdownPanel";
import { OutlinePanel } from "../OutlinePanel";
import { PdfPanel, type usePdfOptions } from "../PdfPanel";
import type { useAudioExport } from "../useAudioExport";

/** The saved file of each format, below the editions folder (the outline's name depends on its format). */
export function exportedFile(format: ExportFormat, outlineFile: string): string {
  const files: Record<ExportFormat, string> = {
    epub: "book.epub",
    markdown: "book.md",
    docx: "manuscript.docx",
    rtf: "manuscript.rtf",
    outline: outlineFile,
    pdf: "book.pdf",
    audiobook: "book.pdf",
  };
  return files[format];
}

/** The sentence under the title, per format. */
export function useFormatDescription(format: ExportFormat): string {
  const { t } = useLingui();
  const descriptions: Record<ExportFormat, string> = {
    audiobook: t`Makes one audio file per chapter with a voice that runs on your computer. Nothing is uploaded.`,
    epub: t`Creates an EPUB 3 e-book in the exports folder.`,
    markdown: t`Writes the whole book as one Markdown file in the exports folder, in reading order. Nothing else is needed on this computer.`,
    docx: t`Writes the whole book as a Word file in standard manuscript format, in the exports folder: double spaced, 12 pt, 1 inch margins, a title page and a running header with your surname. Nothing else is needed on this computer.`,
    rtf: t`Writes the whole book as a Rich Text file in standard manuscript format, in the exports folder, for word processors and submission systems that ask for RTF: double spaced, 12 pt, 1 inch margins, a title page and a running header with your surname. Images must be PNG or JPEG. Nothing else is needed on this computer.`,
    outline: t`Writes the structure of the book (chapters and scenes with their notes) as an outline file in the exports folder. No chapter text is written. Nothing else is needed on this computer.`,
    pdf: t`Creates a print-ready PDF in the exports folder. Typst, the PDF engine, comes with the app.`,
  };
  return descriptions[format];
}

/** What the progress line says at each stage of an export. */
export function useStageText(format: ExportFormat, dir: string, outlineFile: string) {
  const { t } = useLingui();
  const preparing = t`Reading your chapters…`;
  const stages: Record<
    Exclude<ExportFormat, "audiobook">,
    { preparing: string; rendering: string; saving: string }
  > = {
    epub: { preparing, rendering: t`Building EPUB…`, saving: t`Saving ${dir}/book.epub…` },
    markdown: { preparing, rendering: t`Writing Markdown…`, saving: t`Saving ${dir}/book.md…` },
    docx: {
      preparing,
      rendering: t`Writing the Word file…`,
      saving: t`Saving ${dir}/manuscript.docx…`,
    },
    rtf: {
      preparing,
      rendering: t`Writing the Rich Text file…`,
      saving: t`Saving ${dir}/manuscript.rtf…`,
    },
    outline: {
      preparing,
      rendering: t`Writing the outline…`,
      saving: t`Saving ${dir}/${outlineFile}…`,
    },
    pdf: {
      preparing,
      rendering: t`Typesetting the book with Typst…`,
      saving: t`Saving ${dir}/book.pdf…`,
    },
  };
  return stages[format === "audiobook" ? "pdf" : format];
}

/** The format picker at the top of the dialog. */
export function FormatSwitcher({
  format,
  onChange,
}: {
  format: ExportFormat;
  onChange: (f: ExportFormat) => void;
}) {
  const { t } = useLingui();
  return (
    <Segmented<ExportFormat>
      label={t`Format`}
      value={format}
      onChange={onChange}
      items={[
        { value: "epub", label: t`EPUB 3` },
        { value: "pdf", label: t`Print PDF` },
        { value: "markdown", label: t`Markdown` },
        { value: "docx", label: t`Word (.docx)` },
        { value: "rtf", label: t`Rich Text (.rtf)` },
        { value: "audiobook", label: t`Audiobook` },
        { value: "outline", label: t`Outline` },
      ]}
    />
  );
}

/** What the Word, Rich Text, Markdown and outline panels have picked. */
export interface FormatChoices {
  htmlMarks: boolean;
  font: ManuscriptFont;
  outlineFormat: OutlineFormat;
}

export const DEFAULT_CHOICES: FormatChoices = {
  htmlMarks: false,
  font: "times",
  outlineFormat: "opml",
};

/** The options of the chosen format. */
export function FormatPanel({
  format,
  audio,
  scope,
  running,
  choices,
  onChoices,
  pdf,
  onChangeTrimSize,
}: {
  format: ExportFormat;
  audio: ReturnType<typeof useAudioExport>;
  scope: ExportScope;
  running: boolean;
  choices: FormatChoices;
  onChoices: (patch: Partial<FormatChoices>) => void;
  pdf: ReturnType<typeof usePdfOptions>;
  onChangeTrimSize?: () => void;
}) {
  const { font, htmlMarks, outlineFormat } = choices;
  if (format === "audiobook") return <AudioPanel audio={audio} />;
  if (format === "epub") return <EpubPanel {...scope} />;
  if (format === "docx" || format === "rtf") {
    return (
      <ManuscriptPanel font={font} onFont={(f) => onChoices({ font: f })} disabled={running} />
    );
  }
  if (format === "markdown") {
    return (
      <MarkdownPanel
        htmlMarks={htmlMarks}
        onHtmlMarks={(on) => onChoices({ htmlMarks: on })}
        disabled={running}
      />
    );
  }
  if (format === "outline") {
    return (
      <OutlinePanel
        value={outlineFormat}
        onChange={(f) => onChoices({ outlineFormat: f })}
        disabled={running}
      />
    );
  }
  return (
    <PdfPanel options={pdf} running={running} onChangeTrimSize={onChangeTrimSize} {...scope} />
  );
}

/** The alt text check, for the formats that carry images into a document. */
export function FormatChecks({ format, scope }: { format: ExportFormat; scope: ExportScope }) {
  if (format !== "pdf" && format !== "docx" && format !== "rtf") return null;
  return <AltTextCheck {...scope} />;
}

/** The progress line and bar while an export runs. */
export function StageProgress({ text }: { text: string }) {
  return (
    <div className="flex flex-col gap-2">
      <p role="status" className="text-sm text-ink-muted">
        {text}
      </p>
      <div className="h-1.5 overflow-hidden rounded-full bg-border" aria-hidden>
        <div className="h-full w-1/3 animate-pulse rounded-full bg-accent motion-reduce:animate-none" />
      </div>
    </div>
  );
}

/** The progress while an export runs and the failure message, with a way to the Fonts page when a font is missing. */
export function ExportStatus({
  progress,
  error,
  onOpenFonts,
  onClose,
}: {
  /** The progress line while an export runs. */
  progress: string | null;
  error: PdfUiError | null;
  /** Opens Settings, Fonts (the dialog closes first). */
  onOpenFonts?: () => void;
  onClose: () => void;
}) {
  const { t } = useLingui();
  return (
    <>
      {progress !== null && <StageProgress text={progress} />}
      {error && (
        <div className="flex flex-col items-start gap-2.5">
          <Notice role="alert" className="w-full whitespace-pre-wrap wrap-break-word">
            {error.message}
          </Notice>
          {error.code === "font" && onOpenFonts && (
            <Button
              onClick={() => {
                onClose();
                onOpenFonts();
              }}
            >{t`Open Fonts`}</Button>
          )}
        </div>
      )}
    </>
  );
}

/** Formats that have no print preview. */
const NO_PREVIEW: readonly ExportFormat[] = ["markdown", "docx", "rtf", "outline"];

/** The Print preview, Cancel and Export buttons of every format but the audiobook. */
export function ExportFooter({
  format,
  running,
  blocked,
  nothingPicked,
  onPreview,
  onCancel,
}: {
  format: ExportFormat;
  running: boolean;
  /** An edition whose untranslated pages must be handled first. */
  blocked: string | undefined;
  nothingPicked: boolean;
  onPreview?: () => void;
  onCancel: () => void;
}) {
  const { t } = useLingui();
  return (
    <div className="flex flex-wrap items-center justify-between gap-2.5">
      {onPreview && !NO_PREVIEW.includes(format) ? (
        <Button disabled={running} onClick={onPreview} icon={Printer}>{t`Print preview`}</Button>
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
        <Button disabled={running} onClick={onCancel}>{t`Cancel`}</Button>
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
  );
}

/** The buttons at the bottom: the audiobook has its own, every other format gets Print preview, Cancel and Export. */
export function DialogFooter({
  audio,
  onKeepWorking,
  ...footer
}: {
  audio: ReturnType<typeof useAudioExport>;
  onKeepWorking: () => void;
} & Parameters<typeof ExportFooter>[0]) {
  if (footer.format === "audiobook") {
    return <AudioFooter audio={audio} onClose={footer.onCancel} onKeepWorking={onKeepWorking} />;
  }
  return <ExportFooter {...footer} />;
}
