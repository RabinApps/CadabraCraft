import type { ChapterDoc } from "@cadabracraft/shared";

export interface ImportOptions {
  /** Heading level that starts a new chapter. Default 1. */
  splitHeadingLevel?: 1 | 2 | 3;
  /** Title for content that precedes the first chapter heading. Default "Untitled". */
  untitledTitle?: string;
  /** Markdown only: refuse larger input (UTF-16 code units). Default 50,000,000. */
  maxInputChars?: number;
  /** DOCX only: refuse archives whose declared uncompressed size exceeds this. Default 200 MB. */
  maxDecompressedBytes?: number;
  /** DOCX only: refuse archives with more entries than this. Default 10,000. */
  maxEntries?: number;
  /** Maximum block nesting (lists, quotes) kept; deeper content is flattened to text with a warning. Default 32. */
  maxNestingDepth?: number;
}

export type WarningSeverity = "warning" | "info";

export interface ImportWarning {
  /** Stable machine-readable code, see docs/import.md. */
  code: string;
  severity: WarningSeverity;
  message: string;
  /** 1-based source line (Markdown). */
  line?: number;
  /** Number of occurrences this warning stands for. */
  count?: number;
  /** A few short examples of affected content. */
  examples?: string[];
}

export interface ImportAsset {
  /** Where the source referenced it: the Markdown path as written, or the zip entry name for DOCX. */
  sourcePath: string;
  /** Project-relative path used by the image nodes (`assets/...`). */
  targetPath: string;
  mediaType?: string;
  /** Present for DOCX (extracted from the archive). Absent for Markdown: the app copies the file. */
  bytes?: Uint8Array;
}

export interface ImportedChapter {
  title: string;
  doc: ChapterDoc;
}

export interface ImportResult {
  chapters: ImportedChapter[];
  warnings: ImportWarning[];
  assets: ImportAsset[];
}

export type ImportErrorCode =
  | "input-too-large"
  | "too-deeply-nested"
  | "invalid-zip"
  | "too-many-entries"
  | "archive-too-large"
  | "missing-document"
  | "invalid-xml";

export class ImportError extends Error {
  readonly code: ImportErrorCode;
  constructor(code: ImportErrorCode, message: string) {
    super(message);
    this.name = "ImportError";
    this.code = code;
  }
}
