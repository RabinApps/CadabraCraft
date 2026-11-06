import { t } from "@lingui/core/macro";
import type { ImportErrorCode } from "@cadabracraft/import-docx";
import type { OutlineErrorCode } from "@cadabracraft/outline";

/** The sentence for an importer failure code, whichever importer (TypeScript or the Rust `.docx` one) raised it. */
export function describeImportCode(code: ImportErrorCode): string {
  switch (code) {
    case "invalid-zip":
      return t`This does not look like a valid .docx file (it could not be opened as a Word document). Choose another file.`;
    case "archive-too-large":
      return t`This document is too large to import safely. Choose a smaller file, or split it into parts.`;
    case "too-many-entries":
      return t`This document contains too many parts to import safely. Choose another file, or split it into parts.`;
    case "missing-document":
      return t`This .docx file has no document body. It may be damaged or not a Word document. Choose another file.`;
    case "invalid-xml":
      return t`This document's contents could not be read. It may be damaged. Open it in Word, save a copy and try again.`;
    case "too-many-nodes":
      return t`This document has too much content to import safely. Split it into smaller files.`;
    case "input-too-large":
      return t`This file is too large to import. Choose a smaller file.`;
    case "too-deeply-nested":
      return t`This document is nested too deeply to import. Simplify its lists and tables, then try again.`;
  }
}

/** The sentence for an outline file that could not be read (`OutlineError.code`); each says what to do next. */
export function describeOutlineCode(code: OutlineErrorCode): string {
  switch (code) {
    case "too-large":
      return t`This outline file is too large to import. Choose a smaller file, or split it into parts.`;
    case "malformed":
      return t`This outline file is damaged or not written correctly, so it could not be read. Open it in the program that made it, save a copy and try again.`;
    case "not-opml":
      return t`This file is not an OPML outline. Export the outline as OPML from your outliner, then try again.`;
    case "not-csv":
      return t`The first row of this spreadsheet has no column named chapter, title or scene. Add a header row with those names and try again.`;
    case "too-many":
      return t`This outline has too many chapters or scenes to import safely. Split it into smaller files.`;
    case "empty":
      return t`This file has no chapters or scenes to import. Choose another file, or in a Markdown file start each chapter with # and each scene with ##.`;
  }
}
