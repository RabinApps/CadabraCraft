import { ean13Modules, normalizeIsbn } from "@cadabracraft/shared";
import { PdfExportError } from "../errors";

/** Width of one module in mm: the nominal x-dimension (100%). 113 modules make the standard 37.29 mm symbol. */
const MODULE_MM = 0.33;
/** Modules in the white margin left of the symbol (the first digit sits there); the right margin is not drawn. */
const LEFT_QUIET = 11;
const TOTAL_MODULES = 113;
/** Height of the main bars, and how far the guard bars run below them. Digits sit under the main bars. */
const BAR_MM = 22.85;
const GUARD_EXTRA_MM = 5;
const DIGIT_PT = 8;

/** Module indexes (in the 95-module pattern) of the start, centre and end guards. */
function isGuard(p: number): boolean {
  return p < 3 || (p >= 45 && p < 50) || p >= 92;
}

const mm = (n: number): string => `${Number(n.toFixed(3))}mm`;

/**
 * The EAN-13 barcode of an ISBN as Typst source: vector bars (one rectangle per run of bars, the guard bars longer) and the
 * thirteen digits under them. Returns "" for an absent ISBN, so nothing is drawn. A present ISBN that is not valid (shape or
 * check digit) throws a PdfExportError, so a bad number never reaches a print file. The source is a `box` of 37.29 mm by
 * 27.85 mm; the caller places it on the back cover.
 */
export function isbnBarcode(isbn: string | null | undefined): string {
  if (isbn == null || isbn.trim() === "") return "";
  const digits = normalizeIsbn(isbn);
  if (digits === null)
    throw new PdfExportError(
      `The ISBN "${isbn.trim()}" is not a valid ISBN-10 or ISBN-13 (check the digits and the check digit), so no barcode can be drawn. Fix it or clear it before exporting.`,
    );

  const modules = ean13Modules(digits);
  const bars: string[] = [];
  let p = 0;
  while (p < modules.length) {
    // A run is a stretch of equal modules that is all guard or all data, so a guard bar is never merged into a data bar.
    const guard = isGuard(p);
    let end = p;
    while (end < modules.length && modules[end] === modules[p] && isGuard(end) === guard) end++;
    if (modules[p]) {
      const height = guard ? BAR_MM + GUARD_EXTRA_MM : BAR_MM;
      const x = (LEFT_QUIET + p) * MODULE_MM;
      bars.push(
        `#place(top + left, dx: ${mm(x)}, rect(width: ${mm((end - p) * MODULE_MM)}, height: ${mm(height)}, fill: black, stroke: none))`,
      );
    }
    p = end;
  }

  const digitAt = (ch: string, p: number, modulesWide: number): string =>
    `#place(top + left, dx: ${mm((LEFT_QUIET + p) * MODULE_MM)}, dy: ${mm(BAR_MM)}, box(width: ${mm(modulesWide * MODULE_MM)})[#align(center)[#text(size: ${DIGIT_PT}pt)[${ch}]]])`;
  const texts = [digitAt(digits[0] as string, -LEFT_QUIET, LEFT_QUIET)];
  for (let i = 0; i < 6; i++) texts.push(digitAt(digits[i + 1] as string, 3 + 7 * i, 7));
  for (let i = 0; i < 6; i++) texts.push(digitAt(digits[i + 7] as string, 50 + 7 * i, 7));

  const width = mm(TOTAL_MODULES * MODULE_MM);
  const height = mm(BAR_MM + GUARD_EXTRA_MM);
  return `#box(width: ${width}, height: ${height})[\n${bars.join("\n")}\n${texts.join("\n")}\n]\n`;
}
