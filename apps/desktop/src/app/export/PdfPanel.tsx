import { useState } from "react";
import { useLingui } from "@lingui/react/macro";
import type { TrimSize } from "@cadabracraft/export-pdf";
import {
  DEFAULT_TEMPLATE_ID,
  hasTemplate,
  listTemplates,
  resolveTrimSize,
} from "@cadabracraft/templates";
import type { Manifest } from "@cadabracraft/format";
import type { ExportScope } from "../../state/project/types";
import { trimLabel } from "../../lib/export/trimLabels";
import { Select } from "../../ui/forms/Select";
import { useProject } from "../../state/project";
import { usePrintSetup } from "../../state/pages/printSetup";
import { CheckList } from "./CheckList";
import { editionOf, PdfFontSelects, PdfToggles, usePdfCheckList } from "./parts/PdfPanelParts";

/** The print PDF choices, owned by the dialog so it can pass them to the export. */
export function usePdfOptions(manifest: Manifest | null) {
  const [pdfA, setPdfA] = useState(false);
  const [pdfUa, setPdfUa] = useState(false);
  const [withCover, setWithCover] = useState(true);
  const [template, setTemplate] = useState<string | null>(null);
  const { bleed, cropMarks } = usePrintSetup();
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
    pdfUa,
    setPdfUa,
    withCover,
    setWithCover,
    setTemplate,
    current,
    bleed,
    cropMarks,
  };
}
export type PdfOptions = ReturnType<typeof usePdfOptions>;

/** The Print PDF format: print checks for the estimated page count, trim size, template, PDF/A and cover. */
export function PdfPanel({
  options,
  running,
  language,
  onChangeTrimSize,
}: {
  options: PdfOptions;
  running: boolean;
  onChangeTrimSize?: () => void;
} & ExportScope) {
  const { t } = useLingui();
  const manifest = useProject((s) => s.manifest);
  const { trimSize, setTemplate, current } = options;
  const templates = listTemplates();
  const checkList = usePdfCheckList(manifest, language, options);
  return (
    <>
      {checkList.length > 0 && <CheckList checks={checkList} label={t`Print checks`} />}
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
              className="min-h-6 min-w-6 text-xs font-semibold text-accent hover:underline disabled:opacity-50 max-md:min-h-11 max-md:px-2"
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
      <PdfFontSelects manifest={manifest} current={current} running={running} />
      <PdfToggles
        options={options}
        hasCover={!!editionOf(manifest, language)?.cover}
        running={running}
      />
    </>
  );
}
