export type Fact = { value: string; source?: string };

export type Competitor = {
  slug: string;
  name: string;
  tagline: string;
  /** Date the facts below were last checked against the sources (YYYY-MM-DD). */
  checkedOn: string;
  facts: {
    price: Fact;
    platforms: Fact;
    account: Fact;
    localFiles: Fact;
    epub: Fact;
    printPdf: Fact;
    openSource: Fact;
  };
  chooseThem: string;
  chooseUs: string;
};

// Facts are kept to what the vendors state publicly. Verify each against its source before changing
// checkedOn, and never state anything here that cannot be sourced.
export const competitors: Competitor[] = [
  {
    slug: "vellum",
    name: "Vellum",
    tagline: "The Mac book formatter known for polished layouts.",
    checkedOn: "2026-10-26",
    facts: {
      price: {
        value: "Paid, one-time license (ebook and print tiers)",
        source: "https://vellum.pub/",
      },
      platforms: { value: "macOS", source: "https://vellum.pub/" },
      account: { value: "Not verified" },
      localFiles: { value: "Not verified" },
      epub: { value: "Yes", source: "https://vellum.pub/" },
      printPdf: { value: "Yes", source: "https://vellum.pub/" },
      openSource: { value: "No" },
    },
    chooseThem: "You work on a Mac, want its established, polished layouts and are happy to pay for them.",
    chooseUs: "You want a free, source-available app on any desktop, with your book kept as plain local files.",
  },
  {
    slug: "atticus",
    name: "Atticus",
    tagline: "A paid, cross-platform writing and formatting app.",
    checkedOn: "2026-10-26",
    facts: {
      price: { value: "Paid, one-time purchase", source: "https://www.atticus.io/" },
      platforms: {
        value: "Windows, Mac, Linux and Chromebook, in a browser",
        source: "https://www.atticus.io/",
      },
      account: { value: "Not verified" },
      localFiles: {
        value: "Browser-based; most tasks need an internet connection",
        source: "https://www.atticus.io/",
      },
      epub: { value: "Yes", source: "https://www.atticus.io/" },
      printPdf: { value: "Yes", source: "https://www.atticus.io/" },
      openSource: { value: "No" },
    },
    chooseThem: "You want a single paid tool that also runs in a browser and bundles writing and formatting.",
    chooseUs: "You want your manuscript in documented local files and no purchase or account.",
  },
  {
    slug: "scrivener",
    name: "Scrivener",
    tagline: "A long-form writing studio with a compile step.",
    checkedOn: "2026-10-26",
    facts: {
      price: {
        value: "Paid, one-time per desktop platform; iOS sold separately",
        source: "https://www.literatureandlatte.com/scrivener/overview",
      },
      platforms: {
        value: "macOS, Windows and iOS",
        source: "https://www.literatureandlatte.com/scrivener/overview",
      },
      account: { value: "Not verified" },
      localFiles: { value: "Not verified" },
      epub: {
        value: "Yes, via Compile",
        source: "https://www.literatureandlatte.com/scrivener/overview",
      },
      printPdf: {
        value: "Yes, via Compile",
        source: "https://www.literatureandlatte.com/scrivener/overview",
      },
      openSource: { value: "No" },
    },
    chooseThem: "You need research tools, corkboards and a deep writing workspace you already know.",
    chooseUs: "You want a simpler editor focused on getting a clean EPUB and print PDF from open, documented files.",
  },
  {
    slug: "reedsy-studio",
    name: "Reedsy Studio",
    tagline: "A free web editor and formatter from Reedsy.",
    checkedOn: "2026-10-26",
    facts: {
      price: {
        value: "Free core features; check current plans",
        source: "https://reedsy.com/studio",
      },
      platforms: { value: "Web browser", source: "https://reedsy.com/studio" },
      account: { value: "Not verified" },
      localFiles: { value: "Web-based; no offline mode", source: "https://reedsy.com/studio" },
      epub: { value: "Yes", source: "https://reedsy.com/studio" },
      printPdf: { value: "Yes", source: "https://reedsy.com/studio" },
      openSource: { value: "No" },
    },
    chooseThem: "You prefer working in the browser, want free core features, and are fine with a web-based tool.",
    chooseUs: "You want your book on your own computer, working offline, in files you can back up and sync yourself.",
  },
];

export const us = {
  price: "Free",
  platforms: "Desktop (macOS and Linux first, Windows coming soon)",
  account: "No account",
  localFiles: "Yes, plain documented files",
  epub: "Yes, validated EPUB3",
  printPdf: "Yes",
  openSource: "Yes",
};

export type Us = typeof us;
export type FactRow = { key: keyof Us; label: string };
export const factRows: FactRow[] = [
  { key: "price", label: "Price" },
  { key: "platforms", label: "Platforms" },
  { key: "account", label: "Account required" },
  { key: "localFiles", label: "Book kept in local files" },
  { key: "epub", label: "EPUB3 export" },
  { key: "printPdf", label: "Print PDF export" },
  { key: "openSource", label: "Source code available" },
];

export function getCompetitor(slug: string): Competitor | undefined {
  return competitors.find((c) => c.slug === slug);
}
