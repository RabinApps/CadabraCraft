export class PdfExportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PdfExportError";
  }
}

/** A requested font family is not installed or bundled. The export is refused instead of substituting another font. */
export class FontNotAvailableError extends PdfExportError {
  constructor(
    /** Families that were requested (one for an explicit request, several for a template's preference list). */
    public readonly families: string[],
    public readonly role: "body" | "heading",
  ) {
    super(
      families.length === 1
        ? `Font "${families[0]}" (${role}) is not available. Install it or choose another font; the export was not started.`
        : `None of the template's ${role} fonts are available (${families.map((f) => `"${f}"`).join(", ")}). Install one or choose another font.`,
    );
    this.name = "FontNotAvailableError";
  }
}

export class TypstNotFoundError extends PdfExportError {
  /** `message` replaces the default text when a runner already has its own wording (with install advice). */
  constructor(searched: string, message?: string) {
    super(message ?? `The "typst" command was not found (${searched}). Install Typst (https://typst.app, e.g. "brew install typst") and make sure it is on PATH.`);
    this.name = "TypstNotFoundError";
  }
}

export class TypstCompileError extends PdfExportError {
  constructor(public readonly stderr: string) {
    super(`Typst failed to compile the book:\n${stderr.trim()}`);
    this.name = "TypstCompileError";
  }
}

export class TypstTimeoutError extends PdfExportError {
  constructor(public readonly seconds: number) {
    super(`Typst took longer than ${seconds} seconds and was stopped. Try a smaller book or check that Typst is not stuck.`);
    this.name = "TypstTimeoutError";
  }
}

export class MissingAssetError extends PdfExportError {
  constructor(public readonly srcs: string[]) {
    super(`Image data missing for: ${srcs.join(", ")}`);
    this.name = "MissingAssetError";
  }
}
