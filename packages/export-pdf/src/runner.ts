import { PdfExportError } from "./errors";

/** Compile timeout shared by every runner. */
export const COMPILE_TIMEOUT_MS = 120_000;

/**
 * How Typst is actually run. The renderer (font checks, error types, asset checks) is runtime-agnostic and works
 * with any implementation: the Node one in `./node`, or the desktop app's Tauri one.
 *
 * Runners throw `TypstNotFoundError`, `TypstCompileError` or `TypstTimeoutError` as appropriate; any other error
 * from `compile` is wrapped in `TypstCompileError` by `renderPdf`.
 */
export interface TypstRunner {
  /** Font family names Typst can use (`typst fonts`: system and bundled). */
  listFonts(): Promise<string[]>;
  /**
   * Compile `source` (the main file) with `files` (relative path -> bytes) available next to it.
   * File paths must stay inside the compile directory. Resolves to the PDF bytes.
   */
  compile(
    source: string,
    files: Map<string, Uint8Array>,
    options: { pdfA: boolean; pdfUa?: boolean },
  ): Promise<Uint8Array>;
  /**
   * Run `typst query --field value --one <selector>` on `source` with `files` next to it, without producing a PDF.
   * Resolves to Typst's JSON text for the selected element's value.
   */
  query(source: string, files: Map<string, Uint8Array>, selector: string): Promise<string>;
}

/** Throws when `path` could escape the compile directory. Runners call this before writing files. */
export function assertSafeFilePath(path: string): void {
  const ok =
    path !== "" &&
    !path.includes("\\") &&
    !path.includes("\0") &&
    !/^[a-zA-Z]:/.test(path) &&
    path.split("/").every((s) => s !== "" && s !== "." && s !== "..");
  if (!ok) throw new PdfExportError(`Unsafe file path for the PDF export: ${path}`);
}

/** Typst only warns about an unknown font family and substitutes another; treat that as an error. */
export function assertNoUnknownFont(stderr: string): void {
  const line = stderr
    .split("\n")
    .map((l) => l.trim())
    .find((l) => /warning: unknown font family/i.test(l));
  if (!line) return;
  const fam = /unknown font family:\s*(.+)$/i.exec(line)?.[1]?.trim() ?? "unknown";
  throw new PdfExportError(`Typst could not find font "${fam}"; export refused.`);
}
