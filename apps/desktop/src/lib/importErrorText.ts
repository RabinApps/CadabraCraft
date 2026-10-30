import { t } from "@lingui/core/macro";
import type { ImportErrorCode } from "@cadabracraft/import-docx";

/** The sentence for an importer failure code, whichever importer (TypeScript or the Rust `.docx` one) raised it. */
export function describeImportCode(code: ImportErrorCode): string {
  switch (code) {
    case "invalid-zip":
      return t`This does not look like a valid .docx file (it could not be opened as a Word document).`;
    case "archive-too-large":
      return t`This document is too large to import safely.`;
    case "too-many-entries":
      return t`This document contains too many parts to import safely.`;
    case "missing-document":
      return t`This .docx file has no document body. It may be damaged or not a Word document.`;
    case "invalid-xml":
      return t`This document's contents could not be read. It may be damaged.`;
    case "too-many-nodes":
      return t`This document has too much content to import safely.`;
    case "input-too-large":
      return t`This file is too large to import.`;
    case "too-deeply-nested":
      return t`This document is nested too deeply to import.`;
  }
}
