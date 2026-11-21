export type ChangeKind = "New" | "Improved" | "Info";

export type ChangelogEntry = {
  version: string;
  label: string;
  changes: readonly { kind: ChangeKind; text: string }[];
};

// Release notes live on GitHub Releases once a release exists; this page mirrors them.
export const changelog: readonly ChangelogEntry[] = [
  {
    version: "0.1.0",
    label: "First release, 2026-11-21",
    changes: [
      {
        kind: "New",
        text: "Downloads for macOS (universal, signed and notarized) and Linux (x86-64 and arm64 AppImage). Windows is coming soon.",
      },
      {
        kind: "New",
        text: "Write in a rich-text editor with chapters, parts, front and back matter, a contents page, an index and a glossary.",
      },
      { kind: "New", text: "Plan with a scene board, a codex and a timeline." },
      { kind: "New", text: "Import Word, Markdown, HTML and plain-text manuscripts, and outlines." },
      {
        kind: "New",
        text: "Export EPUB 3 (with EPUBCheck), print-ready PDF, Markdown, Word, Rich Text and outlines.",
      },
      {
        kind: "New",
        text: "Language editions: keep one book in several languages and export each one.",
      },
      {
        kind: "New",
        text: "Audiobook export (Opus, FLAC, WAV or M4B with chapters) with voices that run on your computer.",
      },
      {
        kind: "New",
        text: "Chapter history, backups and a recovery offer when a newer copy is found.",
      },
    ],
  },
];
