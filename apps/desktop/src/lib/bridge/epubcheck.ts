import { invoke } from "@tauri-apps/api/core";
import type { EpubcheckReport } from "./types";

/** The EPUB validator (EPUBCheck with a bundled Java runtime). Nothing is sent anywhere: it reads one file of the book folder. */
export const epubcheckBridge = {
  /** Whether the checker can run here; rejects with `{ kind: "not_found", message }` when the bundled copy is missing. */
  epubcheckFind: () => invoke<{ bundled: boolean }>("epubcheck_find"),
  /** Checks the EPUB at `path` (relative to the book folder). Resolves to the report even when the book has errors. Stop it with `epubcheckCancel`. */
  epubcheckValidate: (root: string, path: string) =>
    invoke<EpubcheckReport>("epubcheck_validate", { root, path }),
  epubcheckCancel: () => invoke<void>("epubcheck_cancel"),
};
