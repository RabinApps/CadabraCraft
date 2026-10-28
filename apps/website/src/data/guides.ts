export type GuideSection = { id: string; heading: string; paragraphs: readonly string[] };

export type Guide = {
  slug: string;
  title: string;
  tag: string;
  summary: string;
  /** Meta description. */
  description: string;
  /** YYYY-MM-DD */
  updated: string;
  readMinutes: number;
  intro: string;
  sections: readonly GuideSection[];
};

// Only publish a guide whose steps the current app can do, and keep it in step with docs/user-guide.md.
export const guides: readonly Guide[] = [
  {
    slug: "convert-word-manuscript-to-epub",
    title: "Convert a Word manuscript to EPUB",
    tag: "Import",
    summary: "Split a .docx into chapters, check what was kept, and export an EPUB3.",
    description:
      "Turn a Word (.docx) manuscript into an EPUB3 with CadabraCraft: import, choose where chapters start, read the import report and export.",
    updated: "2026-10-27",
    readMinutes: 4,
    intro:
      "A Word manuscript becomes an EPUB in three moves: import it as a new book, check the chapters, and export. CadabraCraft never changes your original file.",
    sections: [
      {
        id: "import",
        heading: "Import the file",
        paragraphs: [
          "Choose File > Import Manuscript (Cmd/Ctrl+Shift+I), or Import on the start screen. Pick your .docx file, then give the new book a title, an author and an empty folder. Markdown (.md) and HTML files import the same way.",
          "Import always creates a new book. You cannot import into a book that is already open, so bring chapters over afterwards if you need to merge two books.",
        ],
      },
      {
        id: "chapters",
        heading: "Choose where chapters start",
        paragraphs: [
          "The next step previews the chapters the app found. Pick which heading level starts a new chapter (Heading 1, 2 or 3), rename chapters, and leave out anything you do not want in the book.",
          "If a chapter splits in the wrong place, change the heading level and look again. Nothing is written until you confirm.",
        ],
      },
      {
        id: "report",
        heading: "Read the import report",
        paragraphs: [
          "After the import, a report lists anything that could not be kept exactly, such as unsupported Word features or an image that could not be read. A Warning means something was lost or changed and is worth a look. A Note is a routine adjustment.",
          "Use Copy report to keep it. If it says nothing was lost or changed, that is exactly what it means.",
        ],
      },
      {
        id: "edit",
        heading: "Check the chapters",
        paragraphs: [
          "Open a few chapters in the editor, add front and back matter such as a title page or acknowledgements, and reorder chapters if you need to. Add the cover and book details before you export.",
        ],
      },
      {
        id: "export",
        heading: "Export the EPUB",
        paragraphs: [
          "Choose File > Export and pick EPUB. The dialog first checks what it can see, such as a book with no chapters or untitled chapters. The file is saved as book.epub in the exports folder of your book, and exporting again replaces it.",
          "The EPUB3 format is checked with the standard EPUBCheck tool during development, but the app does not run EPUBCheck on your file. Preview it in your store's tool before you publish.",
        ],
      },
    ],
  },
];

export function getGuide(slug: string): Guide | undefined {
  return guides.find((g) => g.slug === slug);
}
