import { describe, expect, it, vi } from "vitest";
import type { ExportActions } from "../../../../state/project/types";
import { runExport, type ExportChoices } from "../exportRunner";

const actions = () => {
  const names = [
    "exportEpub",
    "exportMarkdown",
    "exportDocx",
    "exportRtf",
    "exportOutline",
    "exportPdf",
  ];
  return Object.fromEntries(names.map((n) => [n, vi.fn(async () => {})])) as unknown as Record<
    string,
    ReturnType<typeof vi.fn>
  > &
    ExportActions;
};
const choices = {
  htmlMarks: true,
  font: "Lora",
  outlineFormat: "md",
  pdf: {
    trimSize: "6x9",
    pdfA: true,
    pdfUa: false,
    withCover: true,
    current: "novel",
    bleed: "none",
    cropMarks: false,
  },
} as unknown as ExportChoices;
const scope = { language: "en" } as never;

describe("runExport", () => {
  it.each([
    ["epub", "exportEpub", {}],
    ["markdown", "exportMarkdown", { htmlMarks: true }],
    ["docx", "exportDocx", { font: "Lora" }],
    ["rtf", "exportRtf", { font: "Lora" }],
    ["outline", "exportOutline", { format: "md" }],
  ] as const)("%s calls %s with the panel's choices", async (format, method, extra) => {
    const a = actions();
    await runExport(a, format, scope, choices);
    expect(a[method]).toHaveBeenCalledTimes(1);
    expect(a[method]).toHaveBeenCalledWith(expect.objectContaining({ ...extra }));
  });
  it("pdf passes the print setup", async () => {
    const a = actions();
    await runExport(a, "pdf", scope, choices);
    expect(a.exportPdf).toHaveBeenCalledWith(
      expect.objectContaining({
        trimSize: "6x9",
        pdfA: true,
        pdfUa: false,
        cover: true,
        template: "novel",
        cropMarks: false,
        language: "en",
      }),
    );
  });
});
