import { useEffect, useState } from "react";
import { useLingui } from "@lingui/react/macro";
import { epubChecks, type CheckPage } from "../../lib/exportChecks";
import { useProject } from "../../state/project";
import { CheckList } from "./CheckList";

/** The EPUB format: the accessibility checks for the book as it is now. Mounted only while the dialog shows EPUB. */
export function EpubPanel() {
  const { t } = useLingui();
  const manifest = useProject((s) => s.manifest);
  const readPages = useProject((s) => s.actions.readPages);
  const [altPages, setAltPages] = useState<CheckPage[]>([]);
  useEffect(() => {
    if (!manifest) return;
    let live = true;
    const fileOf = (id: string) =>
      [...manifest.frontMatter, ...manifest.chapters, ...manifest.backMatter].find(
        (e) => e.id === id,
      )?.file;
    readPages().then(
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
  }, [readPages, manifest]);
  const checks = manifest ? epubChecks(manifest, altPages) : [];
  return <CheckList checks={checks} label={t`Checks`} />;
}
