import { useEffect, useState } from "react";
import type { useProject } from "../../../state/project";
import { untranslatedIn } from "../EditionsChecklist";

type Manifest = ReturnType<typeof useProject.getState>["manifest"];

/**
 * The editions to export (the open one until the author picks others) and the ones whose untranslated pages are left out.
 * The checks and the page estimate follow the first picked edition (`language`).
 */
export function useEditionPicks(open: boolean, manifest: Manifest, current: string) {
  const [picked, setPicked] = useState<string[]>([]);
  const [skipped, setSkipped] = useState<string[]>([]);
  useEffect(() => {
    if (open) {
      setPicked(current ? [current] : []);
      setSkipped([]);
    }
    // Reset only when the dialog opens.
  }, [open]);
  const many = !!manifest && manifest.editions.length > 1;
  const language = picked[0] ?? current;
  const scopeOf = (l: string) => ({ language: l, skipUntranslated: skipped.includes(l) });
  const blocked = manifest
    ? picked.find((l) => untranslatedIn(manifest, l).length > 0 && !skipped.includes(l))
    : undefined;
  return {
    picked,
    setPicked,
    skipped,
    setSkipped,
    many,
    language,
    scopeOf,
    blocked,
    nothingPicked: many && picked.length === 0,
  };
}
