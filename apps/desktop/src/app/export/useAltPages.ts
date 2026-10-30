import { sourceFileById } from "@cadabracraft/format";
import { useEffect, useState } from "react";
import type { CheckPage } from "../../lib/exportChecks";
import { useProject } from "../../state/project";

/** Every page's document for `language`, for the image alt-text checks. Empty while loading or when reading fails. */
export function useAltPages(language: string | undefined): CheckPage[] {
  const manifest = useProject((s) => s.manifest);
  const readPages = useProject((s) => s.actions.readPages);
  const [altPages, setAltPages] = useState<CheckPage[]>([]);
  useEffect(() => {
    if (!manifest) return;
    let live = true;
    const fileOf = (id: string) => sourceFileById(manifest, id);
    readPages(language).then(
      (pages) => {
        if (live)
          setAltPages(pages.map((p) => ({ title: p.title, file: fileOf(p.id), doc: p.doc })));
      },
      () => {
        if (live) setAltPages([]);
      },
    );
    return () => {
      live = false;
    };
  }, [readPages, manifest, language]);
  return altPages;
}
