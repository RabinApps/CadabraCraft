import { sourceEdition } from "@cadabracraft/format";
import { useEffect, useMemo, useState } from "react";
import { useLingui } from "@lingui/react/macro";
import { countWords } from "@cadabracraft/shared";
import { TRIM_SIZES, type TrimSize } from "@cadabracraft/export-pdf";
import {
  DEFAULT_TEMPLATE_ID,
  getTemplate,
  hasTemplate,
  listTemplates,
  resolveTrimSize,
} from "@cadabracraft/templates";
import type { Manifest } from "@cadabracraft/format";
import type { ExportScope } from "../../state/project/types";
import { pdfChecks } from "../../lib/exportChecks";
import { estimatePages, wordsPerPage } from "../../lib/printEstimate";
import { readStored, removeStored, writeStored } from "../../lib/persisted";
import { trimLabel } from "../../lib/trimLabels";
import type { PdfUiError } from "../../lib/pdfErrors";
import { Checkbox } from "../../ui/Checkbox";
import { Field } from "../../ui/Input";
import { Select } from "../../ui/Select";
import { useProject } from "../../state/project";
import { CheckList } from "./CheckList";

const TYPST_PATH_KEY = "cadabracraft.typstPath";
/** App preference only (an absolute path), never stored in project files. */
const readTypstPath = (): string => readStored(TYPST_PATH_KEY) ?? "";
export const saveTypstPath = (p: string): void => {
  if (p) writeStored(TYPST_PATH_KEY, p);
  else removeStored(TYPST_PATH_KEY);
};

/** The print PDF choices, owned by the dialog so it can pass them to the export. */
export function usePdfOptions(manifest: Manifest | null) {
  const [pdfA, setPdfA] = useState(false);
  const [withCover, setWithCover] = useState(true);
  const [template, setTemplate] = useState<string | null>(null);
  const [typstPath, setTypstPath] = useState(readTypstPath);
  /** The template in effect: the one picked here, else the book's, else the default. */
  const current =
    template ??
    (manifest && hasTemplate(manifest.template) ? manifest.template : DEFAULT_TEMPLATE_ID);
  /** The book's own page size (Book details), never a choice made here. */
  const trimSize: TrimSize = resolveTrimSize({
    template: current,
    ...(manifest?.trimSize ? { trimSize: manifest.trimSize } : {}),
  });
  return {
    trimSize,
    pdfA,
    setPdfA,
    withCover,
    setWithCover,
    setTemplate,
    typstPath,
    setTypstPath,
    current,
  };
}
export type PdfOptions = ReturnType<typeof usePdfOptions>;

/** The Print PDF format: print checks for the estimated page count, trim size, template, PDF/A, cover and the Typst location. */
export function PdfPanel({
  options,
  running,
  error,
  language,
  onChangeTrimSize,
}: {
  options: PdfOptions;
  running: boolean;
  error: PdfUiError | null;
  onChangeTrimSize?: () => void;
} & ExportScope) {
  const { t } = useLingui();
  const manifest = useProject((s) => s.manifest);
  const readPages = useProject((s) => s.actions.readPages);
  const {
    trimSize,
    pdfA,
    setPdfA,
    withCover,
    setWithCover,
    setTemplate,
    typstPath,
    setTypstPath,
    current,
  } = options;
  const templates = listTemplates();
  const [words, setWords] = useState<number | null>(null);
  useEffect(() => {
    let live = true;
    readPages(language).then(
      (pages) => {
        if (live) setWords(pages.reduce((sum, p) => sum + countWords(p.doc), 0));
      },
      () => {
        if (live) setWords(null);
      },
    );
    return () => {
      live = false;
    };
  }, [readPages, language]);
  const edition = manifest?.editions.find(
    (e) => e.language === (language ?? sourceEdition(manifest.editions).language),
  );
  const pdfCheckList = useMemo(() => {
    if (!manifest || !edition || words === null) return [];
    const print = getTemplate(current).print;
    const margins = print.defaults.marginsIn;
    const perPage = wordsPerPage(TRIM_SIZES[trimSize], margins, print.fontSizePt);
    return pdfChecks({
      estimatedPages: estimatePages(words, manifest.chapters.length, perPage),
      margins,
      hasCover: edition?.cover != null,
    });
  }, [manifest, words, current, trimSize, edition]);
  return (
    <>
      {pdfCheckList.length > 0 && <CheckList checks={pdfCheckList} label={t`Print checks`} />}
      <div className="flex flex-col gap-1.5">
        <span className="text-xs font-semibold text-ink-muted">{t`Trim size`}</span>
        <div className="flex items-center justify-between gap-3 text-sm text-ink">
          <span data-testid="trim-size">
            {trimLabel(trimSize)} · {t`set in Book details`}
          </span>
          {onChangeTrimSize && (
            <button
              type="button"
              disabled={running}
              onClick={onChangeTrimSize}
              className="text-xs font-semibold text-accent hover:underline disabled:opacity-50"
            >{t`Change`}</button>
          )}
        </div>
      </div>
      <Select
        label={t`Template`}
        value={current}
        disabled={running}
        onChange={(e) => setTemplate(e.target.value)}
        hint={templates.find((x) => x.id === current)?.description}
      >
        {templates.map((x) => (
          <option key={x.id} value={x.id}>
            {x.name}
          </option>
        ))}
      </Select>
      <Checkbox
        label={t`PDF/A (archival)`}
        hint={t`Embeds everything needed to open the file in the future.`}
        checked={pdfA}
        disabled={running}
        onChange={(e) => setPdfA(e.target.checked)}
      />
      {edition?.cover && (
        <Checkbox
          label={t`Include the cover`}
          hint={t`Adds the cover as the first page, with a blank page behind it. Turn this off for a print-ready interior file; printers usually want the cover as a separate file.`}
          checked={withCover}
          disabled={running}
          onChange={(e) => setWithCover(e.target.checked)}
        />
      )}
      {(error?.code === "typst-missing" || typstPath) && (
        <Field
          label={t`Typst location (optional)`}
          value={typstPath}
          disabled={running}
          placeholder="/opt/homebrew/bin/typst"
          onChange={(e) => setTypstPath(e.target.value)}
          hint={t`Leave empty to use the Typst that comes with the app.`}
        />
      )}
    </>
  );
}
