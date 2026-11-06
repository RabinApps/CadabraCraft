import { bleedInches } from "../../../state/pages/printSetup";
import type { ExportActions, ExportScope } from "../../../state/project/types";
import type { ExportFormat } from "../exportFormat";
import type { usePdfOptions } from "../PdfPanel";
import type { FormatChoices } from "./ExportDialogParts";

/** The choices of the panels that the file formats read when they are built. */
export interface ExportChoices extends FormatChoices {
  pdf: ReturnType<typeof usePdfOptions>;
}

type Runner = (scope: ExportScope) => Promise<void>;

/** Builds the book in one format for one edition (everything but the audiobook, which has its own flow). */
export function runExport(
  actions: ExportActions,
  format: Exclude<ExportFormat, "audiobook">,
  scope: ExportScope,
  choices: ExportChoices,
): Promise<void> {
  const { htmlMarks, font, outlineFormat, pdf } = choices;
  const runners: Record<typeof format, Runner> = {
    epub: (s) => actions.exportEpub(s),
    markdown: (s) => actions.exportMarkdown({ htmlMarks, ...s }),
    docx: (s) => actions.exportDocx({ font, ...s }),
    rtf: (s) => actions.exportRtf({ font, ...s }),
    outline: (s) => actions.exportOutline({ format: outlineFormat, ...s }),
    pdf: (s) =>
      actions.exportPdf({
        trimSize: pdf.trimSize,
        pdfA: pdf.pdfA,
        pdfUa: pdf.pdfUa,
        cover: pdf.withCover,
        template: pdf.current,
        bleedIn: bleedInches(pdf.bleed),
        cropMarks: pdf.cropMarks,
        ...s,
      }),
  };
  return runners[format](scope);
}
