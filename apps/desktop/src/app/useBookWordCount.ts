import { useEffect, useState } from "react";
import { countWords } from "@cadabracraft/shared";
import { useProject } from "./store";

/** Words in all chapters (front and back matter excluded), or null until the first count. Re-counts a second after the last saved change. */
export function useBookWordCount(): number | null {
  const manifest = useProject((s) => s.manifest);
  const currentDoc = useProject((s) => s.currentDoc);
  const readPages = useProject((s) => s.actions.readPages);
  const [words, setWords] = useState<number | null>(null);
  useEffect(() => {
    if (!manifest) { setWords(null); return; }
    let live = true;
    const timer = setTimeout(() => {
      readPages()
        .then((pages) => { if (live) setWords(pages.filter((p) => p.section === "chapter").reduce((n, p) => n + countWords(p.doc), 0)); })
        .catch(() => { if (live) setWords(null); });
    }, 1000);
    return () => { live = false; clearTimeout(timer); };
  }, [manifest, currentDoc, readPages]);
  return words;
}
