import { chaptersOf, entryRowsIn, isTranslated } from "@cadabracraft/format";
import type { useProject } from "../../../state/project";

type Manifest = ReturnType<typeof useProject.getState>["manifest"];

/**
 * Chapters (not matter) the edition has no translation of yet, which stop the export unless skipped, and the rows the
 * export will read.
 */
export function translationState(manifest: Manifest, language: string, skipUntranslated: boolean) {
  if (!manifest) return { untranslated: [], blocked: false, rows: [] };
  const untranslated = chaptersOf(manifest).filter(
    (e) => !isTranslated(e, language, manifest.editions),
  );
  const rows = entryRowsIn(chaptersOf(manifest), manifest.editions, language).filter(
    (r) => !skipUntranslated || r.translated,
  );
  return { untranslated, blocked: untranslated.length > 0 && !skipUntranslated, rows };
}
