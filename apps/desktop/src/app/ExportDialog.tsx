import { useState } from "react";
import { useLingui } from "@lingui/react/macro";
import { CircleAlert, CircleCheck, FileText, Printer } from "lucide-react";
import { TRIM_SIZES, type TrimSize } from "@cadabracraft/export-pdf";
import { DEFAULT_TEMPLATE_ID, hasTemplate, listTemplates } from "@cadabracraft/templates";
import { PdfUiError } from "../lib/pdfErrors";
import { epubChecks } from "../lib/exportChecks";
import { Button } from "../ui/Button";
import { Checkbox } from "../ui/Checkbox";
import { Modal } from "../ui/Dialog";
import { Field } from "../ui/Input";
import { Segmented } from "../ui/Segmented";
import { Select } from "../ui/Select";
import { cx } from "../ui/cx";
import { useProject } from "./store";

export type ExportFormat = "epub" | "pdf";

const TYPST_PATH_KEY = "cadabracraft.typstPath";
/** App preference only (an absolute path), never stored in project files. */
const readTypstPath = (): string => {
  try {
    return localStorage.getItem(TYPST_PATH_KEY) ?? "";
  } catch {
    return "";
  }
};
const saveTypstPath = (p: string) => {
  try {
    if (p) localStorage.setItem(TYPST_PATH_KEY, p);
    else localStorage.removeItem(TYPST_PATH_KEY);
  } catch {
    /* storage unavailable: the path just is not remembered */
  }
};

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  format: ExportFormat;
  onFormatChange: (f: ExportFormat) => void;
  /** Opens the print preview, which has the page setup. Omitted when the dialog is already in the preview. */
  onPreview?: () => void;
}

/** Export the book as EPUB 3 or as a print PDF (Typst). Shows the EPUB checks before building. */
export function ExportDialog({ open, onOpenChange, format, onFormatChange, onPreview }: Props) {
  const { t } = useLingui();
  const manifest = useProject((s) => s.manifest);
  const stage = useProject((s) => s.exportStage);
  const exportEpub = useProject((s) => s.actions.exportEpub);
  const exportPdf = useProject((s) => s.actions.exportPdf);
  const templates = listTemplates();
  const [trimSize, setTrimSize] = useState<TrimSize>("6x9");
  const [pdfA, setPdfA] = useState(false);
  const [template, setTemplate] = useState<string | null>(null);
  const [typstPath, setTypstPath] = useState(readTypstPath);
  const [error, setError] = useState<PdfUiError | null>(null);
  const running = stage !== null;
  const current = template ?? (manifest && hasTemplate(manifest.template) ? manifest.template : DEFAULT_TEMPLATE_ID);
  const checks = manifest ? epubChecks(manifest) : [];
  const trimLabels: Record<TrimSize, string> = { "5x8": t`5 × 8 in`, "5.5x8.5": t`5.5 × 8.5 in`, "6x9": t`6 × 9 in` };
  const stageText = format === "epub"
    ? { preparing: t`Reading your chapters…`, rendering: t`Building EPUB…`, saving: t`Saving exports/book.epub…` }
    : { preparing: t`Reading your chapters…`, rendering: t`Typesetting the book with Typst…`, saving: t`Saving exports/book.pdf…` };

  const change = (o: boolean) => {
    if (running) return; // an export cannot be cancelled; keep the dialog until it ends
    if (!o) { setError(null); setTemplate(null); }
    onOpenChange(o);
  };
  const submit = async () => {
    setError(null);
    try {
      if (format === "epub") {
        await exportEpub();
      } else {
        saveTypstPath(typstPath.trim());
        await exportPdf({ trimSize, pdfA, template: current, typstPath: typstPath.trim() || undefined });
      }
      change(false);
    } catch (e) {
      setError(e instanceof PdfUiError ? e : new PdfUiError("other", e instanceof Error ? e.message : String(e)));
    }
  };
  return (
    <Modal open={open} onOpenChange={change} title={t`Export book`} description={format === "epub" ? t`Creates an EPUB 3 e-book in the exports folder.` : t`Creates a print-ready PDF in the exports folder. This needs Typst installed on this computer.`}>
      <form className="flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
        <Segmented<ExportFormat>
          label={t`Format`}
          value={format}
          onChange={(f) => { setError(null); onFormatChange(f); }}
          items={[{ value: "epub", label: t`EPUB 3`, icon: FileText }, { value: "pdf", label: t`Print PDF`, icon: Printer }]}
        />
        {format === "epub" ? (
          <ul aria-label={t`Checks`} className="flex flex-col gap-2">
            {checks.map((c) => (
              <li key={c.text} className={cx("flex items-center gap-2 rounded-md px-3 py-2 text-sm", c.tone === "ok" ? "bg-success-soft text-success" : "bg-warn-soft text-warn")}>
                {c.tone === "ok" ? <CircleCheck size={16} aria-hidden /> : <CircleAlert size={16} aria-hidden />}
                {c.text}
              </li>
            ))}
          </ul>
        ) : (
          <>
            <Select label={t`Trim size`} value={trimSize} disabled={running} onChange={(e) => setTrimSize(e.target.value as TrimSize)}>
              {(Object.keys(TRIM_SIZES) as TrimSize[]).map((id) => <option key={id} value={id}>{trimLabels[id]}</option>)}
            </Select>
            <Select label={t`Template`} value={current} disabled={running} onChange={(e) => setTemplate(e.target.value)} hint={templates.find((x) => x.id === current)?.description}>
              {templates.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
            </Select>
            <Checkbox label={t`PDF/A (archival)`} hint={t`Embeds everything needed to open the file in the future.`} checked={pdfA} disabled={running} onChange={(e) => setPdfA(e.target.checked)} />
            {(error?.code === "typst-missing" || typstPath) && (
              <Field label={t`Typst location (optional)`} value={typstPath} disabled={running} placeholder="/opt/homebrew/bin/typst" onChange={(e) => setTypstPath(e.target.value)} hint={t`Leave empty to use the typst found on this computer.`} />
            )}
          </>
        )}
        {running && (
          <div className="flex flex-col gap-2">
            <p role="status" className="text-sm text-ink-muted">{stageText[stage]}</p>
            <div className="h-1.5 overflow-hidden rounded-full bg-border" aria-hidden>
              <div className="h-full w-1/3 animate-pulse rounded-full bg-accent motion-reduce:animate-none" />
            </div>
          </div>
        )}
        {error && <p role="alert" className="whitespace-pre-wrap break-words rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">{error.message}</p>}
        <div className="flex flex-wrap items-center justify-between gap-2.5">
          {onPreview ? <Button disabled={running} onClick={onPreview} icon={Printer}>{t`Print preview`}</Button> : <span />}
          <div className="flex gap-2.5">
            <Button disabled={running} onClick={() => change(false)}>{t`Cancel`}</Button>
            <Button type="submit" variant="primary" icon={FileText} disabled={running}>{running ? t`Exporting…` : t`Export`}</Button>
          </div>
        </div>
      </form>
    </Modal>
  );
}

