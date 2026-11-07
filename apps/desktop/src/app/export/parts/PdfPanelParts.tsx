import { sourceEdition, type Manifest } from "@cadabracraft/format";
import { useEffect, useMemo, useState } from "react";
import { useLingui } from "@lingui/react/macro";
import { getTemplate } from "@cadabracraft/templates";
import type { BookPage } from "../../../state/project/types";
import { pdfChecks } from "../../../lib/export/exportChecks";
import { layoutOfPages } from "../../../lib/page/bookPages";
import { Checkbox } from "../../../ui/forms/Checkbox";
import { Select } from "../../../ui/forms/Select";
import { useProject } from "../../../state/project";
import { setBleed, setCropMarks } from "../../../state/pages/printSetup";
import { useFontList } from "../../hooks/useFontList";
import type { PdfOptions } from "../PdfPanel";

/** The edition of `language` (the source edition by default) in the open book. */
export function editionOf(manifest: Manifest | null, language: string | undefined) {
  return manifest?.editions.find(
    (e) => e.language === (language ?? sourceEdition(manifest.editions).language),
  );
}

/** The print checks for the estimated page count of an edition; empty until its pages are read. */
export function usePdfCheckList(
  manifest: Manifest | null,
  language: string | undefined,
  options: PdfOptions,
) {
  const readPages = useProject((s) => s.actions.readPages);
  const { trimSize, current, bleed, cropMarks } = options;
  const [pages, setPages] = useState<BookPage[] | null>(null);
  useEffect(() => {
    let live = true;
    readPages(language).then(
      (read) => {
        if (live) setPages(read);
      },
      () => {
        if (live) setPages(null);
      },
    );
    return () => {
      live = false;
    };
  }, [readPages, language]);
  const edition = editionOf(manifest, language);
  return useMemo(() => {
    if (!manifest || !edition || pages === null) return [];
    const print = getTemplate(current).print;
    const margins = print.defaults.marginsIn;
    return pdfChecks({
      estimatedPages: layoutOfPages({ template: current, trimSize }, pages).physical,
      margins,
      hasCover: edition?.cover != null,
      bleed,
      cropMarks,
    });
  }, [manifest, pages, current, trimSize, edition, bleed, cropMarks]);
}

/** The body and heading font pickers, saved with the book. */
export function PdfFontSelects({
  manifest,
  current,
  running,
}: {
  manifest: Manifest | null;
  /** The template in effect. */
  current: string;
  running: boolean;
}) {
  const { t } = useLingui();
  const setBookFonts = useProject((s) => s.actions.setBookFonts);
  const { families } = useFontList();
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
    </>
  );
}

/** The PDF/A, PDF/UA, bleed, crop marks and cover checkboxes. */
export function PdfToggles({
  options,
  hasCover,
  running,
}: {
  options: PdfOptions;
  hasCover: boolean;
  running: boolean;
}) {
  const { t } = useLingui();
  const { pdfA, setPdfA, pdfUa, setPdfUa, withCover, setWithCover, bleed, cropMarks } = options;
  return (
    <>
      <Checkbox
        label={t`PDF/A (archival)`}
        hint={t`Embeds everything needed to open the file in the future.`}
        checked={pdfA}
        disabled={running}
        onChange={(e) => setPdfA(e.target.checked)}
      />
      <Checkbox
        label={t`PDF/UA (accessible)`}
        hint={t`Tags headings, lists, tables and images so screen readers can read the file, and marks page numbers and running headers as decoration. Can be combined with PDF/A. Images need a description (alt text) in the editor.`}
        checked={pdfUa}
        disabled={running}
        onChange={(e) => setPdfUa(e.target.checked)}
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
      {hasCover && (
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
