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
} from "@cadabracraft/templates";
import type { Manifest } from "@cadabracraft/format";
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
  const [trimSize, setTrimSize] = useState<TrimSize>("6x9");
  const [pdfA, setPdfA] = useState(false);
  const [withCover, setWithCover] = useState(true);
  const [template, setTemplate] = useState<string | null>(null);
  const [typstPath, setTypstPath] = useState(readTypstPath);
  /** The template in effect: the one picked here, else the book's, else the default. */
  const current =
    template ??
    (manifest && hasTemplate(manifest.template) ? manifest.template : DEFAULT_TEMPLATE_ID);
  return {
    trimSize,
    setTrimSize,
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
}: {
  options: PdfOptions;
  running: boolean;
  error: PdfUiError | null;
}) {
  const { t } = useLingui();
  const manifest = useProject((s) => s.manifest);
  const readPages = useProject((s) => s.actions.readPages);
  const {
    trimSize,
    setTrimSize,
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
    readPages().then(
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
  }, [readPages]);
  const pdfCheckList = useMemo(() => {
    if (!manifest || words === null) return [];
    const print = getTemplate(current).print;
    const margins = print.defaults.marginsIn;
    const perPage = wordsPerPage(TRIM_SIZES[trimSize], margins, print.fontSizePt);
    return pdfChecks({
      estimatedPages: estimatePages(words, manifest.chapters.length, perPage),
      margins,
      hasCover: sourceEdition(manifest.editions).cover !== null,
    });
  }, [manifest, words, current, trimSize]);
  return (
    <>
      {pdfCheckList.length > 0 && <CheckList checks={pdfCheckList} label={t`Print checks`} />}
      <Select
        label={t`Trim size`}
        value={trimSize}
        disabled={running}
        onChange={(e) => setTrimSize(e.target.value as TrimSize)}
      >
        {(Object.keys(TRIM_SIZES) as TrimSize[]).map((id) => (
          <option key={id} value={id}>
            {trimLabel(id)}
          </option>
        ))}
      </Select>
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
      {manifest && sourceEdition(manifest.editions).cover && (
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
