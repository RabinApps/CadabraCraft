export const features = [
  {
    title: "Local-first",
    body: "Your book is a folder of plain, documented files. No account, no server, nothing leaves your machine.",
  },
  {
    title: "Sync how you like",
    body: "Point the folder at Google Drive, Dropbox or iCloud Drive. If a file changes elsewhere, you get a conflict copy, never a silent overwrite.",
  },
  {
    title: "A calm editor",
    body: "A rich-text editor where the manuscript comes first. Organize chapters, add front and back matter, reorder them, and restore anything from the project trash.",
  },
  {
    title: "EPUB3 export",
    body: "Export an EPUB3 built to pass EPUBCheck straight from your chapters.",
  },
  {
    title: "Print-ready PDF",
    body: "Novel, nonfiction and modern templates, trim sizes, PDF/A and a print preview. PDF export uses Typst, which comes with the app.",
  },
  {
    title: "Bring your manuscript",
    body: "Import Word (.docx), Markdown and HTML manuscripts into chapters.",
  },
  {
    title: "Focus mode",
    body: "Hide everything but the page. Read mode shows the chapter the way a reader will.",
  },
  {
    title: "Light and dark",
    body: "Designed in both themes, from desktop down to a phone-width layout.",
  },
  {
    title: "Open, all the way down",
    body: "The app, the file format and the exporters are developed in the open under the RabinApps organization on GitHub.",
  },
] as const;

const highlights = ["Local-first", "Print-ready PDF", "A calm editor"];
export const benefits = features.filter((f) => highlights.includes(f.title));

export type FeatureGroup = {
  id: string;
  eyebrow: string;
  title: string;
  lead: string;
  points: readonly string[];
  /** Name of a screenshot in /public/screens (`<name>-light.png` and `<name>-dark.png`). Rows without one render as text only. */
  shot?: { name: string; alt: string };
};

export const featureGroups: readonly FeatureGroup[] = [
  {
    id: "write",
    eyebrow: "Write",
    title: "A calm editor",
    lead: "The manuscript comes first. Everything else stays out of the way until you want it.",
    points: [
      "Chapters, front and back matter, reordered by drag",
      "Focus mode, and a reading mode that shows the page as a reader sees it",
      "Find and replace across the whole book, with regular expressions",
      "A session word goal and a status bar that stays quiet",
    ],
    shot: {
      name: "editor",
      alt: "The CadabraCraft editor showing a chapter of a novel as a book page, with the chapter list on the left and book details on the right.",
    },
  },
  {
    id: "import",
    eyebrow: "Import",
    title: "Bring your manuscript",
    lead: "Start from the book you already have, not a blank page.",
    points: [
      "Word (.docx), Markdown and HTML manuscripts become chapters",
      "Preview the detected chapters, rename them, skip some or change the heading level that splits them",
      "An import report lists anything that could not be kept exactly; your original file is never changed",
    ],
  },
  {
    id: "export",
    eyebrow: "Export",
    title: "EPUB3, print PDF, Word and Markdown",
    lead: "One manuscript, every format a book needs.",
    points: [
      "EPUB3 built to pass EPUBCheck",
      "Novel, nonfiction and modern PDF templates, trim sizes, PDF/A and a print preview",
      "Word (.docx) and Markdown export",
      "PDF export uses Typst, which comes with the app",
    ],
    shot: {
      name: "export",
      alt: "The Export book dialog with a choice of EPUB 3, print PDF, Markdown, Word, Rich Text, audiobook and outline.",
    },
  },
  {
    id: "listen",
    eyebrow: "Listen",
    title: "An audiobook from your manuscript",
    lead: "Voices run on your computer. Nothing is uploaded.",
    points: [
      "Opus, FLAC, WAV or M4B with chapters",
      "Voices are an optional download that only starts when you ask for it",
    ],
  },
  {
    id: "translate",
    eyebrow: "Translate",
    title: "Language editions",
    lead: "Keep the same book in several languages in one project.",
    points: [
      "Switch editions in the editor, including right-to-left scripts",
      "Export each language into its own folder",
      "Untranslated chapters are flagged, and you choose whether to skip them",
    ],
  },
  {
    id: "own",
    eyebrow: "Own",
    title: "Local-first and safe",
    lead: "Your book is a folder of plain, documented files.",
    points: [
      "No account, no cloud service, no telemetry",
      "Automatic versions and a History dialog to compare and restore",
      "Sync the folder with Google Drive, Dropbox or iCloud Drive; a file changed elsewhere becomes a conflict copy, never a silent overwrite",
    ],
  },
  {
    id: "automate",
    eyebrow: "Automate",
    title: "Works with your AI agent",
    lead: "A local MCP server creates, edits, imports and exports books without opening the app.",
    points: ["Runs on your machine, with no network calls", "Same file format and exporters as the app"],
  },
];

export const smallThings = [
  {
    title: "Sync how you like",
    body: "Point the folder at Google Drive, Dropbox or iCloud Drive.",
  },
  { title: "Focus mode", body: "Hide everything but the page." },
  { title: "Light and dark", body: "Designed in both themes, from desktop to phone width." },
  { title: "Project trash", body: "Restore any chapter you removed." },
  {
    title: "Open all the way down",
    body: "The app, file format and exporters are developed in the open on GitHub.",
  },
  { title: "No lock-in", body: "Export Markdown or Word and leave with everything." },
] as const;

export const formatChips = ["EPUB3", "PDF", "Word", "Markdown", "Audiobook"] as const;

export const formats = [
  {
    name: "EPUB3",
    use: "Ebooks",
    lead: "Reflowable EPUB3 for ebook stores and e-readers. The app can check the exported file with the standard EPUBCheck validator, on your computer.",
    points: ["Language, cover and details come from your book details", "Front and back matter are included"],
  },
  {
    name: "Print PDF",
    use: "Print",
    lead: "Print-ready interiors built by Typst, with the template, trim size and margins you pick.",
    points: [
      "Novel, nonfiction and modern templates",
      "5 x 8, 5.5 x 8.5 and 6 x 9 inch trim sizes, PDF/A, running headers and page numbers",
      "Print checks warn about common paperback rules before you export",
    ],
  },
  {
    name: "Word (.docx)",
    use: "Import and export",
    lead: "Bring a manuscript in from Word, or hand an editor a .docx.",
    points: [
      "Headings become chapters, and you preview the split before importing",
      "Export a .docx to share with editors and reviewers",
    ],
  },
  {
    name: "Markdown",
    use: "Import and export",
    lead: "Plain text in, plain text out. Good for version control and other tools.",
    points: [
      "Tables, footnotes and fenced code map to book content",
      "The whole book exports as one file in reading order",
    ],
  },
  {
    name: "Audiobook",
    use: "Listening",
    lead: "Render a narrated audiobook on your own computer.",
    points: ["Opus, FLAC, WAV or M4B with chapters", "Voices download only when you ask for them"],
  },
] as const;

export const steps = [
  {
    title: "Bring it in",
    body: "Import a Word, Markdown or HTML manuscript, or start a blank book. Chapters appear in the sidebar.",
  },
  {
    title: "Write and shape it",
    body: "A calm editor, front and back matter, language editions and a history you can restore.",
  },
  {
    title: "Export it",
    body: "EPUB3, print PDF, Word, Markdown or an audiobook, from the same chapters.",
  },
] as const;

export const faq = [
  {
    q: "Is CadabraCraft really free?",
    a: "Yes. Authors and publishing companies can use it free to write and publish books, including books they sell. Nobody sells the software itself, including its maker. Sponsorship pays for development time and keeps the project independent.",
  },
  {
    q: "Do I need an account?",
    a: "No. There is no account, no cloud service and no telemetry. The site and the app make no tracking calls.",
  },
  {
    q: "Does it work offline?",
    a: "Yes. Writing, importing and exporting need no network. The app checks GitHub Releases for updates only if you allow it, and audiobook voices download only when you ask for them.",
  },
  {
    q: "Where is my book stored?",
    a: "In a folder of plain, documented files on your computer. You choose whether to sync that folder with Google Drive, Dropbox or iCloud Drive.",
  },
  {
    q: "Is it safe to sync the folder with Dropbox or Google Drive?",
    a: "Yes. If a file changes in two places, CadabraCraft keeps the other version as a conflict copy instead of overwriting it, and the History dialog can restore earlier versions of a chapter.",
  },
  {
    q: "Can I get my files back out?",
    a: "Yes. Your book is plain files you own, and you can export Markdown or Word at any time.",
  },
  {
    q: "What formats can I import and export?",
    a: "Import Word (.docx), Markdown and HTML. Export EPUB3, print-ready PDF, Word, Markdown and audiobooks. PDF export uses Typst, which comes with the app.",
  },
  {
    q: "Which platforms does it support?",
    a: "It is a desktop app built with Tauri, with macOS and Linux downloads on GitHub Releases and Windows coming soon.",
  },
] as const;

export const formatFaq = [
  {
    q: "Is the EPUB validated?",
    a: "Yes. EPUBCheck, the standard EPUB validator, is built into the app: in the Export dialog, choose Check EPUB to run it on the file you exported, or turn on the switch to check after every export. It runs on your computer, so nothing is uploaded. It cannot promise that a store accepts the book, so look at it in your store's previewer too.",
  },
  {
    q: "Can I get my book back out?",
    a: "Yes. Export Markdown or Word at any time. Your book is plain files you own.",
  },
] as const;
