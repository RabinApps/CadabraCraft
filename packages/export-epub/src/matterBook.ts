// A book with every kind of front and back matter page, shared by the exporter tests (not part of the public API).
import type { ChapterDoc } from "@cadabracraft/shared";
import type { EpubChapter } from "./epub";

const doc = (t: string): ChapterDoc => ({
  type: "doc",
  content: [{ type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: t }] }, { type: "paragraph", content: [{ type: "text", text: `${t} text` }] }],
});

export const matterBook = (): EpubChapter[] => [
  { id: "fm-1", title: "Title Page", doc: doc("Title Page"), section: "front", kind: "title-page" },
  { id: "fm-2", title: "Copyright", doc: doc("Copyright"), section: "front", kind: "copyright" },
  { id: "fm-3", title: "Dedication", doc: doc("Dedication"), section: "front", kind: "dedication" },
  { id: "fm-4", title: "Epigraph", doc: doc("Epigraph"), section: "front", kind: "epigraph" },
  { id: "fm-5", title: "Foreword", doc: doc("Foreword"), section: "front", kind: "foreword" },
  { id: "fm-6", title: "Preface", doc: doc("Preface"), section: "front", kind: "preface" },
  { id: "fm-7", title: "A Note", doc: doc("A Note"), section: "front", kind: "custom" },
  { id: "ch-1", title: "Chapter One", doc: doc("Chapter One") },
  { id: "ch-2", title: "Chapter Two", doc: doc("Chapter Two"), section: "chapter" },
  { id: "bm-1", title: "Acknowledgments", doc: doc("Acknowledgments"), section: "back", kind: "acknowledgments" },
  { id: "bm-2", title: "About the Author", doc: doc("About the Author"), section: "back", kind: "about-the-author" },
  { id: "bm-3", title: "Also by A. Writer", doc: doc("Also by"), section: "back", kind: "also-by" },
  { id: "bm-4", title: "Colophon", doc: doc("Colophon"), section: "back", kind: "colophon" },
  { id: "bm-5", title: "Appendix", doc: doc("Appendix"), section: "back", kind: "custom" },
];
