// Loads fixtures/manuscripts/full-book.json for tests and the sample script (not part of the public API).
import { readFileSync } from "node:fs";
import type { PdfBook, PdfChapter } from "./types";

const root = new URL("../../../fixtures/manuscripts/", import.meta.url);

export interface FullBook {
  book: PdfBook;
  chapters: PdfChapter[];
  /** Image bytes keyed by the `src` used in the chapters. */
  assets: Record<string, Uint8Array>;
}

export function loadFullBook(): FullBook {
  const raw = JSON.parse(readFileSync(new URL("full-book.json", root), "utf8"));
  const assets: Record<string, Uint8Array> = {
    "assets/gradient.png": new Uint8Array(readFileSync(new URL("assets/gradient.png", root))),
  };
  return {
    book: { title: raw.title, author: raw.author, language: raw.language },
    chapters: raw.chapters,
    assets,
  };
}
