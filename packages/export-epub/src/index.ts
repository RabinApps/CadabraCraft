export { buildEpub, type BuildOptions, type ContentsItem, type EpubChapter } from "./epub";
export { INDEX_PAGE, GLOSSARY_PAGE } from "./generated";
export { chapterToXhtmlBody, collectImageSources, imageAltStats } from "./xhtml";
export { EpubExportError, type EpubErrorCode, type EpubErrorWhere } from "./errors";
export { accessibilityMetadata, type A11yFacts } from "./a11y";
