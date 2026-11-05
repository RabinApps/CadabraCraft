import { useEffect, useState } from "react";
import { entryFile, sourceFile, translationFile } from "@cadabracraft/format";
import { bridge } from "../../lib/bridge";
import { sceneRows, type SceneRow } from "../../lib/scenes";
import { useProject } from "../../state/project/index";
import { parseChapter } from "../../state/project/util";

/**
 * The scenes of chapters that are not open, read from their files when a chapter is expanded. The open chapter's scenes come
 * from the editor (the store keeps its document), so it is left out here.
 */
export function useChapterScenes(ids: string[]): Record<string, SceneRow[]> {
  const manifest = useProject((s) => s.manifest);
  const root = useProject((s) => s.root);
  const language = useProject((s) => s.activeLanguage ?? s.manifest?.editions[0]?.language ?? "");
  const [byChapter, setByChapter] = useState<Record<string, SceneRow[]>>({});
  const key = ids.join(",");
  useEffect(() => {
    if (!manifest || !root) return;
    let cancelled = false;
    void (async () => {
      for (const id of key ? key.split(",") : []) {
        const entry = manifest.chapters.find((c) => c.id === id);
        if (!entry) continue;
        const file =
          entryFile(entry, language) ??
          translationFile(sourceFile(entry, manifest.editions), language);
        if (!file) continue;
        const read = await bridge.readFile(root, file);
        if (!read) continue;
        try {
          const rows = sceneRows(parseChapter(read.contents, file));
          if (!cancelled) setByChapter((prev) => ({ ...prev, [id]: rows }));
        } catch {
          // A file that will not open is reported when someone opens it; the list here just stays empty.
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [key, manifest, root, language]);
  return byChapter;
}
