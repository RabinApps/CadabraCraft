import { useEffect, useState } from "react";
import { entryFile, sourceFile, translationFile } from "@cadabracraft/format";
import { bridge } from "../../lib/bridge";
import { sceneRows, type SceneRow } from "../../lib/scenes/scenes";
import { useProject } from "../../state/project/index";
import { parseChapter } from "../../state/project/util";

/**
 * What `derive` makes of each listed chapter's file, read when the chapter is listed and read again whenever `version` changes
 * (a different `version` means the files changed, for example after a scene moved). `derive` must be a stable function (declared
 * outside the component), since a new one would read every chapter again.
 */
export function useChapterReads<T>(
  ids: string[],
  derive: (doc: unknown) => T,
  version = "",
): Record<string, T> {
  const manifest = useProject((s) => s.manifest);
  const root = useProject((s) => s.root);
  const language = useProject((s) => s.activeLanguage ?? s.manifest?.editions[0]?.language ?? "");
  const [byChapter, setByChapter] = useState<Record<string, T>>({});
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
          const value = derive(parseChapter(read.contents, file));
          if (!cancelled) setByChapter((prev) => ({ ...prev, [id]: value }));
        } catch {
          // A file that will not open is reported when someone opens it; the list here just stays empty.
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [key, manifest, root, language, derive, version]);
  return byChapter;
}

/**
 * The scenes of chapters that are not open, read from their files when a chapter is expanded. The open chapter's scenes come
 * from the editor (the store keeps its document), so it is left out here.
 */
export function useChapterScenes(ids: string[]): Record<string, SceneRow[]> {
  return useChapterReads(ids, sceneRows);
}
