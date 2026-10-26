import { t } from "@lingui/core/macro";
import { FontNotAvailableError, MissingAssetError, TypstCompileError, TypstNotFoundError, TypstTimeoutError } from "@cadabracraft/export-pdf";

export type PdfErrorCode = "typst-missing" | "font" | "compile" | "timeout" | "asset" | "other";

/** An export failure with a message written for the author and a code the dialog can act on. */
export class PdfUiError extends Error {
  constructor(public readonly code: PdfErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "PdfUiError";
  }
}

/** Maps export-pdf errors to translated, actionable messages. */
export function describePdfError(e: unknown): PdfUiError {
  if (e instanceof PdfUiError) return e;
  const cause = { cause: e };
  if (e instanceof TypstNotFoundError) return new PdfUiError("typst-missing", e.message, cause);
  if (e instanceof FontNotAvailableError) {
    const fonts = e.families.map((f) => `"${f}"`).join(", ");
    return new PdfUiError("font", t`The font ${fonts} is not installed, so the PDF was not created. Install it, or choose a template whose fonts you have.`, cause);
  }
  if (e instanceof TypstCompileError) return new PdfUiError("compile", t`Typst could not build the PDF:\n${e.stderr.trim()}`, cause);
  if (e instanceof TypstTimeoutError) return new PdfUiError("timeout", t`Typst took longer than ${e.seconds} seconds and was stopped. Try again, or export fewer chapters.`, cause);
  if (e instanceof MissingAssetError) return new PdfUiError("asset", t`Missing image file ${e.srcs.join(", ")}`, cause);
  return new PdfUiError("other", e instanceof Error ? e.message : String(e), cause);
}
