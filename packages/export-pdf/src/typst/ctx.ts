import { PdfExportError } from "../errors";

export interface Ctx {
  images: Map<string, string>;
  /** Set when a chapter opening used `dropcap`, so the vendored package is written next to the source. */
  usesDropCap?: boolean;
  /** Max image height in inches. */
  maxImageIn: number;
  assets: Record<string, Uint8Array> | undefined;
  /** `PdfOptions.blockMarks`: chapters carry page marks. */
  marks?: boolean;
  /** Set while a top-level block is written with marks: the page entry's index, the block's index in it and the index the next leaf of the block will have. */
  mark?: { chapter: number; block: number; leaf: number } | undefined;
  /** `PdfOptions.charMarks` as the words to mark inside, by `chapter:block:leaf`. */
  charMarks?: Map<string, Set<number>>;
}

export const unsupported = (type: string): never => {
  throw new PdfExportError(`Unsupported node type in chapter: ${type}`);
};
