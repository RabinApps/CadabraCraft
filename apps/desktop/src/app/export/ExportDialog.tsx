import { useState } from "react";
import { exportDir, sourceEdition } from "@cadabracraft/format";
import { useLingui } from "@lingui/react/macro";
import { PdfUiError } from "../../lib/export/pdfErrors";
import { errText } from "../../lib/projectError";
import { Modal } from "../../ui/Dialog";
import { useSponsor } from "../../state/app/sponsor";
import { useProject } from "../../state/project";
import { EditionsChecklist } from "./EditionsChecklist";
import { OUTLINE_FORMATS } from "@cadabracraft/outline";
import { usePdfOptions } from "./PdfPanel";
import { useAudioExport } from "./useAudioExport";
import type { ExportFormat } from "./exportFormat";
import {
  ExportStatus,
  type FormatChoices,
  DEFAULT_CHOICES,
  DialogFooter,
  exportedFile,
  FormatChecks,
  FormatSwitcher,
  FormatPanel,
  useFormatDescription,
  useStageText,
} from "./parts/ExportDialogParts";
import { runExport } from "./parts/exportRunner";
import { useEditionPicks } from "./parts/useEditionPicks";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  format: ExportFormat;
  onFormatChange: (f: ExportFormat) => void;
  /** Opens the print preview, which has the page setup. Omitted when the dialog is already in the preview. */
  onPreview?: () => void;
  /** Opens Book details, where the trim size is set. Omitted when the dialog is already in the print preview. */
  onChangeTrimSize?: () => void;
  /** Opens Settings, Fonts, where missing print fonts are downloaded. */
  onOpenFonts?: () => void;
}

/** Export the book as EPUB 3, a print PDF (Typst), Markdown, Word, Rich Text or an audiobook. Each format's panel shows its checks or options before building. */
export function ExportDialog({
  open,
  onOpenChange,
  format,
  onFormatChange,
  onPreview,
  onChangeTrimSize,
  onOpenFonts,
}: Props) {
  const { t } = useLingui();
  const manifest = useProject((s) => s.manifest);
  const stage = useProject((s) => s.exportStage);
  const actions = useProject((s) => s.actions);
  const activeLanguage = useProject((s) => s.activeLanguage);
  const [choices, setChoices] = useState<FormatChoices>(DEFAULT_CHOICES);
  const [error, setError] = useState<PdfUiError | null>(null);
  const current = activeLanguage ?? (manifest ? sourceEdition(manifest.editions).language : "");
  const [exporting, setExporting] = useState<string | null>(null);
  const picks = useEditionPicks(open, manifest, current);
  const { picked, skipped, many, language, scopeOf, blocked, nothingPicked } = picks;
  const scope = scopeOf(language);
  const dir = exportDir(exporting ?? language);
  const outlineFile = OUTLINE_FORMATS[choices.outlineFormat].file;
  const pdf = usePdfOptions(manifest);
  const audio = useAudioExport({ active: open && format === "audiobook", setError });
  const running = stage !== null;
  const stageText = useStageText(format, dir, outlineFile);
  const description = useFormatDescription(format);
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
      const languages = picked.length ? picked : [current];
      // One edition after the other; the first failure stops the rest and is shown.
      for (const l of languages) {
        setExporting(l);
        await runExport(actions, format, scopeOf(l), { ...choices, pdf });
      }
      const last = exportDir(languages.at(-1)!);
      change(false);
      useSponsor.getState().offer(`${last}/${exportedFile(format, outlineFile)}`);
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
      description={description}
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <FormatSwitcher
          format={format}
          onChange={(f) => {
            setError(null);
            onFormatChange(f);
          }}
        />
        {format !== "audiobook" && many && manifest && (
          <EditionsChecklist
            manifest={manifest}
            current={current}
            picked={picked}
            skipped={skipped}
            onPicked={picks.setPicked}
            onSkipped={picks.setSkipped}
            disabled={running}
          />
        )}
        <FormatPanel
          format={format}
          audio={audio}
          scope={scope}
          running={running}
          choices={choices}
          onChoices={(patch) => setChoices({ ...choices, ...patch })}
          pdf={pdf}
          onChangeTrimSize={onChangeTrimSize}
        />
        <FormatChecks format={format} scope={scope} />
        <ExportStatus
          progress={running ? stageText[stage] : null}
          error={error}
          onOpenFonts={onOpenFonts}
          onClose={() => change(false)}
        />
        <DialogFooter
          format={format}
          audio={audio}
          running={running}
          blocked={blocked}
          nothingPicked={nothingPicked}
          onPreview={onPreview}
          onCancel={() => change(false)}
          onKeepWorking={() => onOpenChange(false)}
        />
      </form>
    </Modal>
  );
}
