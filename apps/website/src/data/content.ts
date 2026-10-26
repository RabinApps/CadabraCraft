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
    body: "Export an EPUB3 that passes EPUBCheck straight from your chapters.",
  },
  {
    title: "Print-ready PDF",
    body: "Novel, nonfiction and modern templates, trim sizes, PDF/A and a print preview. PDF export uses Typst, which you install once on your computer.",
  },
  {
    title: "Bring your manuscript",
    body: "Import Word (.docx) and Markdown manuscripts into chapters.",
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

export const faq = [
  {
    q: "Is CadabraCraft really free?",
    a: "Yes. It is free and open source. Sponsorship pays for development time and keeps the project independent.",
  },
  {
    q: "Do I need an account?",
    a: "No. There is no account, no cloud service and no telemetry. The site and the app make no tracking calls.",
  },
  {
    q: "Where is my book stored?",
    a: "In a folder of plain, documented files on your computer. You choose whether to sync that folder with Google Drive, Dropbox or iCloud Drive.",
  },
  {
    q: "What formats can I export?",
    a: "EPUB3 and print-ready PDF. PDF export uses Typst, which you install once on your computer.",
  },
  {
    q: "Which platforms does it support?",
    a: "It is a desktop app built with Tauri. Downloads will appear on GitHub Releases once the first release is published.",
  },
] as const;
