import { sourceEdition } from "@cadabracraft/format";
import { useEffect, useMemo, useState } from "react";
import { useLingui } from "@lingui/react/macro";
import { countWords } from "@cadabracraft/shared";
import type { TrimSize } from "@cadabracraft/export-pdf";
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
import { bookPageCount } from "../../lib/pageNumbering";
import { trimLabel } from "../../lib/trimLabels";
import { Checkbox } from "../../ui/Checkbox";
import { Select } from "../../ui/Select";
import { useProject } from "../../state/project";
import { setBleed, setCropMarks, usePrintSetup } from "../../state/printSetup";
import { useFontList } from "../hooks/useFontList";
import { CheckList } from "./CheckList";

/** The print PDF choices, owned by the dialog so it can pass them to the export. */
export function usePdfOptions(manifest: Manifest | null) {
  const [pdfA, setPdfA] = useState(false);
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
  const readPages = useProject((s) => s.actions.readPages);
  const setBookFonts = useProject((s) => s.actions.setBookFonts);
  const { families } = useFontList();
  const {
    trimSize,
    pdfA,
    setPdfA,
    withCover,
    setWithCover,
    setTemplate,
    current,
    bleed,
    cropMarks,
  } = options;
  const templates = listTemplates();
  const [words, setWords] = useState<number[] | null>(null);
  useEffect(() => {
    let live = true;
    readPages(language).then(
      (pages) => {
        if (live)
          setWords(pages.filter((p) => p.section === "chapter").map((p) => countWords(p.doc)));
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
    return pdfChecks({
      estimatedPages: bookPageCount({ template: current, trimSize }, words).pages,
      margins,
      hasCover: edition?.cover != null,
      bleed,
      cropMarks,
    });
  }, [manifest, words, current, trimSize, edition, bleed, cropMarks]);
  const bodyFont = manifest?.fonts?.body ?? "";
  const headingFont = manifest?.fonts?.heading ?? "";
  // The book's own choice stays in the list when this computer lacks it, so the select shows it instead of the wrong font.
  const familyOptions = (chosen: string) =>
    chosen && !families.includes(chosen) ? [chosen, ...families] : families;
  const pickFont = (key: "body" | "heading", value: string) =>
    void setBookFonts({ body: bodyFont, heading: headingFont, [key]: value }).catch(
      () => undefined,
    );
  const templateBody = getTemplate(current).print.bodyFonts[0] ?? "";
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
              className="text-xs font-semibold text-accent hover:underline disabled:opacity-50 max-md:min-h-11 max-md:px-2"
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
      <Select
        label={t`Body font`}
        value={bodyFont}
        disabled={running}
        onChange={(e) => pickFont("body", e.target.value)}
        hint={t`The font of the running text. It is saved with the book; the font file is not.`}
      >
        <option value="">{t`Template default (${templateBody})`}</option>
        {familyOptions(bodyFont).map((f) => (
          <option key={f} value={f}>
            {f}
          </option>
        ))}
      </Select>
      <Select
        label={t`Heading font`}
        value={headingFont}
        disabled={running}
        onChange={(e) => pickFont("heading", e.target.value)}
        hint={t`The font of titles and headings. Settings, Fonts has more.`}
      >
        <option value="">{t`Same as body`}</option>
        {familyOptions(headingFont).map((f) => (
          <option key={f} value={f}>
            {f}
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
      <Checkbox
        label={t`Add bleed (0.125 in)`}
        hint={t`Makes each page larger by 0.125 in on the top, bottom and outside edges, as Amazon KDP asks for when artwork or images run to the edge. Margins stay measured from the trim.`}
        checked={bleed}
        disabled={running}
        onChange={(e) => setBleed(e.target.checked)}
      />
      <Checkbox
        label={t`Crop marks`}
        hint={t`Draws trim marks outside the bleed and makes the page larger on every side. Amazon KDP does not accept them.`}
        checked={cropMarks}
        disabled={running}
        onChange={(e) => setCropMarks(e.target.checked)}
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
    </>
  );
}
