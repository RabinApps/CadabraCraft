// The full fixture book wrapped in front and back matter, shared by the exporter tests (not part of the public API).
import type { ChapterDoc, DocNode, MatterKind, Section } from "@cadabracraft/shared";
import { loadFullBook } from "./fixtures";
import type { PdfChapter } from "../types";

const h1 = (t: string): DocNode => ({
  type: "heading",
  attrs: { level: 1 },
  content: [{ type: "text", text: t }],
});
const p = (t: string, italic = false): DocNode => ({
  type: "paragraph",
  content: [{ type: "text", text: t, ...(italic ? { marks: [{ type: "italic" as const }] } : {}) }],
});
const doc = (...content: DocNode[]): ChapterDoc => ({ type: "doc", content });

export const page = (
  id: string,
  title: string,
  section: Section,
  kind: MatterKind,
  d: ChapterDoc,
): PdfChapter => ({ id, title, section, kind, doc: d });

export function matterPages() {
  const front: PdfChapter[] = [
    page("fm-1", "Title Page", "front", "title-page", doc(h1("The Long Quay"), p("Test Author"))),
    page(
      "fm-2",
      "Copyright",
      "front",
      "copyright",
      doc(p("© 2026 Test Author"), p("All rights reserved."), p("ISBN 978-3-16-148410-0")),
    ),
    page("fm-3", "Dedication", "front", "dedication", doc(p("For the harbour keepers.", true))),
    page(
      "fm-4",
      "Foreword",
      "front",
      "foreword",
      doc(h1("Foreword"), p("A foreword paragraph about the quay.")),
    ),
    page("fm-5", "Preface", "front", "preface", doc(h1("Preface"), p("A preface paragraph."))),
  ];
  const back: PdfChapter[] = [
    page(
      "bm-1",
      "Acknowledgments",
      "back",
      "acknowledgments",
      doc(h1("Acknowledgments"), p("Thanks to everyone on the quay.")),
    ),
    page(
      "bm-2",
      "About the Author",
      "back",
      "about-the-author",
      doc(h1("About the Author"), p("Test Author writes about water.")),
    ),
  ];
  return { front, back };
}

/** Front matter, the four fixture chapters, back matter. */
export function loadMatterBook() {
  const { book, chapters, assets } = loadFullBook();
  const { front, back } = matterPages();
  return { book, chapters, assets, front, back, all: [...front, ...chapters, ...back] };
}
