import { PdfExportError } from "../errors";

export interface Ctx {
  images: Map<string, string>;
  /** Set when a chapter opening used `dropcap`, so the vendored package is written next to the source. */
  usesDropCap?: boolean;
  /** Max image height in inches. */
  maxImageIn: number;
  assets: Record<string, Uint8Array> | undefined;
}

export const unsupported = (type: string): never => {
  throw new PdfExportError(`Unsupported node type in chapter: ${type}`);
};
